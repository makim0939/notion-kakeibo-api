import type { BlockObjectRequest, PageObjectResponse, QueryDataSourceResponse } from "@notionhq/client";
import { Client } from "@notionhq/client";
import { monthRange } from "../lib/date";
import { describeError, log } from "../lib/log";
import type { CategoryHistoryRecord, ExpenseRequest, MonthlyExpense } from "../types/expense";
import { UNCATEGORIZED } from "../types/expense";
import type { SummaryValues } from "../types/summary";
import { ACHIEVED_MARK, SUMMARY_PROPERTY } from "../types/summary";
import type { ExistingBlock } from "./summary-page";
import { MANAGED_MARKER_PREFIX, normalizeNotionText, signatureOfExisting, summarySignature } from "./summary-page";

/**
 * Notion 呼び出しのタイムアウト。SDK の既定は60秒だが、
 * ショートカット側を待たせ続けないよう短くしている。
 */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * リトライ設定。SDK が 429 と（冪等なメソッドの）5xx を
 * Retry-After 準拠の指数バックオフで再送してくれる。
 * 支出登録の POST は冪等でないため 5xx では再送されず、二重登録が起きない。
 */
const RETRY_OPTIONS = {
	maxRetries: 2,
	initialRetryDelayMs: 300,
	maxRetryDelayMs: 4_000,
};

/** Notion API の1リクエストあたりの最大件数。 */
const NOTION_PAGE_SIZE = 100;

/** 1クエリで走査するページ数の上限。無限ループと過大なレイテンシを防ぐ。 */
const MAX_PAGES_PER_QUERY = 20;

/** ブロックの挿入位置。SDK の ContentPositionSchema は公開されていないので、必要な形だけ持つ。 */
type ContentPosition = { type: "start" } | { type: "end" } | { type: "after_block"; after_block: { id: string } };

type PageProperty = PageObjectResponse["properties"][string];

type QueryDataSourceResult = QueryDataSourceResponse["results"][number];

type NotionServiceConfig = {
	apiKey: string;
	databaseId: string;
	dataSourceId: string;
	summaryDataSourceId: string;
};

type NotionCreatePageResponse = {
	id: string;
	url: string | null;
};

type PropertyShapeMap = {
	title: "title";
	select: "select";
	rich_text: "rich_text";
	number: "number";
	checkbox: "checkbox";
	date: "date";
};

type PropertyOf<T extends Record<string, keyof PropertyShapeMap>> = {
	[K in keyof T]: Extract<PageProperty, { type: PropertyShapeMap[T[K]] }>;
};

export function createNotionService(config: NotionServiceConfig) {
	const notion = new Client({
		auth: config.apiKey,
		timeoutMs: REQUEST_TIMEOUT_MS,
		retry: RETRY_OPTIONS,
	});
	const databaseId = config.databaseId;
	const dataSourceId = config.dataSourceId;
	const summaryDataSourceId = config.summaryDataSourceId;

	return {
		createExpensePage: (expense: ExpenseRequest, summaryPageId: string | null) =>
			createExpensePage(notion, databaseId, expense, summaryPageId),
		fetchExpenseCategoryRecords: (limit: number) => fetchExpenseCategoryRecords(notion, dataSourceId, limit),
		fetchSummaryIdByDate: (date: Date) => fetchSummaryIdByDate(notion, summaryDataSourceId, date),
		fetchSummaryValues: (pageId: string) => fetchSummaryValues(notion, pageId, summaryDataSourceId),
		replaceSummarySection: (pageId: string, blocks: BlockObjectRequest[]) =>
			replaceSummarySection(notion, pageId, blocks),
		queryExpensesInMonth: (month: string) => queryExpensesInMonth(notion, dataSourceId, month),
		linkExpensesToSummary: (month: string, summaryPageId: string) =>
			linkExpensesToSummary(notion, dataSourceId, month, summaryPageId),
		updateExpenseViewForMonth: (summaryPageId: string, month: string) =>
			updateExpenseViewForMonth(notion, dataSourceId, summaryPageId, month),
		querySummaryPageIds: (from: string, toExclusive: string) =>
			querySummaryPageIds(notion, summaryDataSourceId, from, toExclusive),
	};
}

export async function createExpensePage(
	notion: Client,
	databaseId: string,
	expense: ExpenseRequest,
	summaryPageId: string | null,
): Promise<NotionCreatePageResponse> {
	const response = await notion.pages.create({
		parent: {
			database_id: databaseId,
		},
		properties: {
			名前: {
				title: [{ text: { content: expense.name } }],
			},
			金額: { number: expense.amount },
			支払い方法: { select: { name: expense.paymentMethod } },
			購入日: { date: { start: expense.date } },
			カテゴリ: { select: { name: expense.category ?? UNCATEGORIZED } },
			...(summaryPageId ? { 月次サマリ: { relation: [{ id: summaryPageId }] } } : {}),
		},
	});

	return { id: response.id, url: "url" in response ? response.url : null };
}

/**
 * カテゴリ学習に使う直近の支出履歴を取得する。
 * DB 全件を舐めると件数の増加に比例して登録が遅くなるため、
 * 購入日の新しい順に必要な件数だけ取得して打ち切る。
 */
export async function fetchExpenseCategoryRecords(
	notion: Client,
	dataSourceId: string,
	limit: number,
): Promise<CategoryHistoryRecord[]> {
	const shape = {
		名前: "title",
		カテゴリ: "select",
	} as const;

	const pages = await fetchDataSourcePages(
		notion,
		{
			data_source_id: dataSourceId,
			filter: {
				property: "カテゴリ",
				select: { does_not_equal: UNCATEGORIZED },
			},
			sorts: [{ property: "購入日", direction: "descending" }],
		},
		limit,
	);

	return pages.flatMap((page) => {
		if (!hasProperties(page.properties, shape)) return [];

		if (!page.properties.名前.title.length || !page.properties.カテゴリ.select) return [];

		return [
			{
				名前: page.properties.名前.title[0]?.plain_text,
				カテゴリ: page.properties.カテゴリ.select.name,
			},
		];
	});
}

export async function fetchSummaryIdByDate(notion: Client, dataSourceId: string, date: Date): Promise<string | null> {
	const year = date.getFullYear();
	const month = date.getMonth() + 1;
	const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
	const endDate = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
	const pages = await fetchDataSourcePages(notion, {
		data_source_id: dataSourceId,
		filter: {
			and: [
				{
					property: "日付",
					date: {
						on_or_after: startDate,
					},
				},
				{
					property: "日付",
					date: {
						before: endDate,
					},
				},
			],
		},
		page_size: 1,
	});

	return pages[0]?.id ?? null;
}

/**
 * ページングしながら取得する。
 * `limit` を渡すとその件数に達した時点で、渡さない場合もページ数の上限で打ち切る。
 */
async function fetchDataSourcePages(
	notion: Client,
	params: Omit<Parameters<Client["dataSources"]["query"]>[0], "start_cursor">,
	limit?: number,
): Promise<PageObjectResponse[]> {
	const pages: PageObjectResponse[] = [];
	let startCursor: string | undefined;

	for (let page = 0; page < MAX_PAGES_PER_QUERY; page++) {
		const remaining = limit === undefined ? NOTION_PAGE_SIZE : limit - pages.length;
		const response = await notion.dataSources.query({
			...params,
			page_size: Math.min(params.page_size ?? NOTION_PAGE_SIZE, remaining),
			start_cursor: startCursor,
		});

		pages.push(...response.results.filter(isFullPage));

		if (!response.has_more || !response.next_cursor) {
			break;
		}
		if (limit !== undefined && pages.length >= limit) {
			break;
		}

		startCursor = response.next_cursor;
	}

	return limit === undefined ? pages : pages.slice(0, limit);
}

function extractTitle(property: unknown): string | undefined {
	if (!isRecord(property) || property.type !== "title" || !Array.isArray(property.title)) {
		return undefined;
	}
	const text = property.title
		.map((part) => (isRecord(part) && typeof part.plain_text === "string" ? part.plain_text : ""))
		.join("")
		.trim();
	return text || undefined;
}

function extractDateStart(property: unknown): string | null {
	if (!isRecord(property) || property.type !== "date" || !isRecord(property.date)) {
		return null;
	}
	return typeof property.date.start === "string" ? property.date.start.slice(0, 10) : null;
}

function isFullPage(page: QueryDataSourceResult): page is PageObjectResponse {
	return "properties" in page;
}

function hasProperties<T extends Record<string, keyof PropertyShapeMap>>(
	properties: PageObjectResponse["properties"],
	shape: T,
): properties is PropertyOf<T> {
	return Object.entries(shape).every(([key, type]) => {
		return properties[key]?.type === type;
	});
}

/**
 * サマリページの値を読み出す。
 * 取り違えたページに書き込まないよう、月次サマリのデータソース配下かを確認する。
 */
export async function fetchSummaryValues(
	notion: Client,
	pageId: string,
	expectedDataSourceId: string,
): Promise<SummaryValues> {
	const page = await notion.pages.retrieve({ page_id: pageId });

	if (!("properties" in page)) {
		throw new SummaryPageError("summary_page_unavailable", "サマリページを読み取れませんでした。");
	}

	if (!belongsToDataSource(page.parent, expectedDataSourceId)) {
		throw new SummaryPageError("not_a_summary_page", "指定されたページは月次サマリのページではありません。");
	}

	const properties = page.properties;
	const read = (name: string) => readNumber(properties[name]);

	return {
		title: extractTitle(properties[SUMMARY_PROPERTY.title]) ?? "",
		date: extractDateStart(properties[SUMMARY_PROPERTY.date]),
		totalAssets: read(SUMMARY_PROPERTY.totalAssets),
		previousTotalAssets: read(SUMMARY_PROPERTY.previousTotalAssets),
		savings: read(SUMMARY_PROPERTY.savings),
		previousSavings: read(SUMMARY_PROPERTY.previousSavings),
		investment: read(SUMMARY_PROPERTY.investment),
		previousInvestment: read(SUMMARY_PROPERTY.previousInvestment),
		income: read(SUMMARY_PROPERTY.income),
		expense: read(SUMMARY_PROPERTY.expense),
		discretionaryExpense: read(SUMMARY_PROPERTY.discretionaryExpense),
		savingsGoal: read(SUMMARY_PROPERTY.savingsGoal),
		expenseGoal: read(SUMMARY_PROPERTY.expenseGoal),
		investmentGoal: read(SUMMARY_PROPERTY.investmentGoal),
		savingsGoalAchieved: readAchieved(properties[SUMMARY_PROPERTY.savingsGoalAchieved]),
		expenseGoalAchieved: readAchieved(properties[SUMMARY_PROPERTY.expenseGoalAchieved]),
	};
}

export type SummarySectionStatus = "created" | "updated" | "unchanged";

/**
 * 自動生成セクションを最新の内容に差し替える。
 * 目印のコールアウトがあればその子ブロックだけを作り直し、無ければページ末尾に新規作成する。
 * ユーザが書いた既存ブロックには一切触れない。
 *
 * 生成結果が現在の内容と同じなら何も書かない。定期実行しても
 * Notion の更新履歴が汚れず、「最終更新」が実際に中身が変わった時刻を指す。
 */
export async function replaceSummarySection(
	notion: Client,
	pageId: string,
	blocks: BlockObjectRequest[],
): Promise<{ status: SummarySectionStatus }> {
	const children = await listPageBlocks(notion, pageId);
	const region = findManagedRegion(children);

	if (!region) {
		// ページ先頭に置く。リンクドDBビューより上に来るので、開いてすぐ数字が目に入る。
		await appendInChunks(notion, pageId, blocks, { type: "start" });
		return { status: "created" };
	}

	const existing = children.slice(region.start, region.end + 1);

	// 先頭の目印は最終更新時刻なので毎回変わる。比較からは外す。
	if (signatureOfExisting(existing.slice(1)) === summarySignature(blocks.slice(1))) {
		return { status: "unchanged" };
	}

	await rewriteRegion(notion, pageId, children, region, existing, blocks);

	return { status: "updated" };
}

/**
 * 管理範囲を作り直す。
 *
 * 表だけは作り直さずに中身を書き換える。表の列幅は Notion API から
 * 読むことも書くこともできず、作り直すと手で調整した幅が失われるため。
 */
async function rewriteRegion(
	notion: Client,
	pageId: string,
	children: ExistingBlock[],
	region: { start: number; end: number },
	existing: ExistingBlock[],
	blocks: BlockObjectRequest[],
): Promise<void> {
	const currentTable = existing.find((block) => block.type === "table");
	const nextIndex = blocks.findIndex((block) => "table" in block);
	const nextTable = nextIndex === -1 ? undefined : blocks[nextIndex];

	// 表が無い、または列数が変わった場合は作り直すしかない。
	if (!currentTable || !nextTable || !sameTableWidth(currentTable, nextTable)) {
		for (const block of existing) {
			await notion.blocks.delete({ block_id: block.id });
		}
		await appendInChunks(notion, pageId, blocks, positionOf(children, region.start));
		return;
	}

	for (const block of existing) {
		if (block.id !== currentTable.id) {
			await notion.blocks.delete({ block_id: block.id });
		}
	}

	await appendInChunks(notion, pageId, blocks.slice(0, nextIndex), positionOf(children, region.start));
	await updateTableRows(notion, currentTable, nextTable);
	await appendInChunks(notion, pageId, blocks.slice(nextIndex + 1), {
		type: "after_block",
		after_block: { id: currentTable.id },
	});
}

function sameTableWidth(current: ExistingBlock, next: BlockObjectRequest): boolean {
	const currentWidth = (current.table as { table_width?: number } | undefined)?.table_width;
	const nextWidth = ("table" in next ? (next.table as { table_width?: number }) : undefined)?.table_width;
	return currentWidth !== undefined && currentWidth === nextWidth;
}

/** 表の行を上から順に書き換える。過不足は行の追加・削除で合わせる。 */
async function updateTableRows(notion: Client, current: ExistingBlock, next: BlockObjectRequest): Promise<void> {
	const currentRows = current.children ?? [];
	const nextRows = (next as { table: { children: BlockObjectRequest[] } }).table.children;
	const shared = Math.min(currentRows.length, nextRows.length);

	for (let index = 0; index < shared; index += 1) {
		const row = nextRows[index] as { table_row: unknown };
		await notion.blocks.update({
			block_id: currentRows[index].id,
			table_row: row.table_row,
		} as Parameters<typeof notion.blocks.update>[0]);
	}

	if (nextRows.length > shared) {
		await notion.blocks.children.append({
			block_id: current.id,
			children: nextRows.slice(shared),
		});
	}

	for (const row of currentRows.slice(nextRows.length)) {
		await notion.blocks.delete({ block_id: row.id });
	}
}

/**
 * 自動生成セクションの範囲を探す。
 *
 * ページ先頭の「🔄 最終更新 …」から始まり、テンプレート由来のブロックの手前で終わる。
 * 終端の目印を別に置くとページに余計な行が増えるので、こちらが生成しない
 * 種類のブロック（見出し3・リンクドDBビュー）が現れた時点を境界とみなす。
 * 区切り線はどちらの持ち物か判別できないため、末尾のものは範囲に含めない。
 */
function findManagedRegion(blocks: ExistingBlock[]): { start: number; end: number } | undefined {
	const start = blocks.findIndex(
		(block) => block.type === "paragraph" && plainTextOf(block).startsWith(MANAGED_MARKER_PREFIX),
	);
	if (start === -1) {
		return undefined;
	}

	let end = start;
	for (let index = start + 1; index < blocks.length; index += 1) {
		if (blocks[index].type === "heading_3" || blocks[index].type === "child_database") {
			break;
		}
		end = index;
	}

	while (end > start && blocks[end].type === "divider") {
		end -= 1;
	}

	return { start, end };
}

/** 削除した位置にそのまま書き戻すための挿入位置。 */
function positionOf(blocks: ExistingBlock[], start: number): ContentPosition {
	const previous = blocks[start - 1];
	return previous ? { type: "after_block", after_block: { id: previous.id } } : { type: "start" };
}

function plainTextOf(block: ExistingBlock): string {
	const body = block[block.type] as { rich_text?: { plain_text: string }[] } | undefined;
	return normalizeNotionText(body?.rich_text?.map((part) => part.plain_text).join("") ?? "");
}

/**
 * ページのブロックを読む。
 * 表の行は1段、段組みは「列 → 中身」で2段ぶら下がるので、そこまで潜って読む
 * （中まで見ないと「数値が変わったのに変化なし」と誤判定する）。
 */
const MANAGED_BLOCK_DEPTH = 2;

function listPageBlocks(notion: Client, pageId: string): Promise<ExistingBlock[]> {
	return listChildren(notion, pageId, MANAGED_BLOCK_DEPTH);
}

/**
 * 指定ブロックの子を全部読む。
 * 表は行が子ブロックになるので、1段だけ潜って中身も取る
 * （中身まで見ないと「表の数値が変わったのに変化なし」と誤判定するため）。
 */
async function listChildren(notion: Client, blockId: string, remainingDepth: number): Promise<ExistingBlock[]> {
	const blocks: ExistingBlock[] = [];
	let cursor: string | undefined;

	do {
		const response = await notion.blocks.children.list({
			block_id: blockId,
			start_cursor: cursor,
			page_size: NOTION_PAGE_SIZE,
		});
		for (const block of response.results) {
			if (!("type" in block)) {
				continue;
			}
			const entry = block as unknown as ExistingBlock;
			// リンクドDBビューは子を辿れないので触らない。
			if (block.has_children && remainingDepth > 0 && block.type !== "child_database") {
				entry.children = await listChildren(notion, block.id, remainingDepth - 1);
			}
			blocks.push(entry);
		}
		cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
	} while (cursor);

	return blocks;
}

/** append は1リクエスト100ブロックまでなので分割して送る。 */
async function appendInChunks(
	notion: Client,
	blockId: string,
	blocks: BlockObjectRequest[],
	position: ContentPosition,
): Promise<void> {
	let at = position;

	for (let index = 0; index < blocks.length; index += NOTION_PAGE_SIZE) {
		const response = await notion.blocks.children.append({
			block_id: blockId,
			children: blocks.slice(index, index + NOTION_PAGE_SIZE),
			position: at,
		});

		// 2回目以降は、直前に入れた最後のブロックの後ろに続ける。
		const last = response.results.at(-1);
		if (last) {
			at = { type: "after_block", after_block: { id: last.id } };
		}
	}
}

/**
 * ページが指定のデータソース配下かを判定する。
 * DB ページの parent は {type:"data_source_id", data_source_id, database_id} で返る。
 * database_id はデータソースIDとは別物なので、data_source_id だけを見る。
 */
function belongsToDataSource(parent: unknown, dataSourceId: string): boolean {
	if (!isRecord(parent) || typeof parent.data_source_id !== "string") {
		return false;
	}
	return parent.data_source_id.replaceAll("-", "") === dataSourceId.replaceAll("-", "");
}

function readNumber(property: unknown): number | null {
	if (!isRecord(property)) {
		return null;
	}

	switch (property.type) {
		case "number":
			return typeof property.number === "number" ? property.number : null;
		case "formula":
			return isRecord(property.formula) && typeof property.formula.number === "number" ? property.formula.number : null;
		case "rollup":
			return readRollupNumber(property.rollup);
		default:
			return null;
	}
}

/**
 * ロールアップは function によって形が変わる。
 * sum なら number、show_original なら配列（中身は number か formula）で返ってくる。
 */
function readRollupNumber(rollup: unknown): number | null {
	if (!isRecord(rollup)) {
		return null;
	}

	if (typeof rollup.number === "number") {
		return rollup.number;
	}

	if (Array.isArray(rollup.array)) {
		for (const item of rollup.array) {
			const value = readNumber(item);
			if (value !== null) {
				return value;
			}
		}
	}

	return null;
}

function readAchieved(property: unknown): boolean {
	if (!isRecord(property) || property.type !== "formula" || !isRecord(property.formula)) {
		return false;
	}
	return property.formula.string === ACHIEVED_MARK;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** サマリ更新で想定内の失敗を表す。 */
export class SummaryPageError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = "SummaryPageError";
	}
}

/** 指定期間に「日付」が入る月次サマリページのIDを新しい順に返す。 */
export async function querySummaryPageIds(
	notion: Client,
	dataSourceId: string,
	from: string,
	toExclusive: string,
): Promise<string[]> {
	const pages = await fetchDataSourcePages(notion, {
		data_source_id: dataSourceId,
		filter: {
			and: [
				{ property: SUMMARY_PROPERTY.date, date: { on_or_after: from } },
				{ property: SUMMARY_PROPERTY.date, date: { before: toExclusive } },
			],
		},
		sorts: [{ property: SUMMARY_PROPERTY.date, direction: "descending" }],
	});

	return pages.map((page) => page.id);
}

/** 支出ページから集計に必要なプロパティだけを取り出す形。 */
const EXPENSE_LIST_SHAPE = {
	名前: "title",
	金額: "number",
	カテゴリ: "select",
	購入日: "date",
} as const;

/** 1ヶ月分として読み込む支出の上限。想定外の件数でページが肥大化するのを防ぐ。 */
const MAX_EXPENSES_PER_MONTH = 500;

/** 指定月の支出を金額の大きい順に取得する。月次サマリの明細・集計に使う。 */
export async function queryExpensesInMonth(
	notion: Client,
	dataSourceId: string,
	month: string,
): Promise<{ items: MonthlyExpense[]; truncated: boolean }> {
	const { start, endExclusive } = monthRange(month);

	const pages = await fetchDataSourcePages(
		notion,
		{
			data_source_id: dataSourceId,
			filter: {
				and: [
					{ property: "購入日", date: { on_or_after: start } },
					{ property: "購入日", date: { before: endExclusive } },
				],
			},
			sorts: [{ property: "金額", direction: "descending" }],
		},
		MAX_EXPENSES_PER_MONTH,
	);

	const items: MonthlyExpense[] = [];
	for (const page of pages) {
		if (!hasProperties(page.properties, EXPENSE_LIST_SHAPE)) {
			continue;
		}
		const properties = page.properties;
		items.push({
			name: properties.名前.title
				.map((part) => part.plain_text)
				.join("")
				.trim(),
			amount: properties.金額.number ?? 0,
			category: properties.カテゴリ.select?.name ?? UNCATEGORIZED,
			date: properties.購入日.date?.start.slice(0, 10) ?? null,
		});
	}

	return { items, truncated: pages.length >= MAX_EXPENSES_PER_MONTH };
}

/**
 * 1回の実行でリレーションを張り直す上限。
 * Notion 側の書き込みは1件1リクエストなので、
 * 想定外の件数を一気に処理して実行時間を食い潰さないよう区切る。
 */
const MAX_RELATION_LINKS_PER_RUN = 50;

/**
 * 指定月の支出のうち「月次サマリ」リレーションが空のものを、その月のサマリページに繋ぐ。
 *
 * Notion で直接入力した支出はリレーションを張り忘れやすく、
 * 張り忘れるとサマリ側の集計プロパティ（総支出など）から丸ごと漏れる。
 * 購入日から所属する月は一意に決まるので、ここで機械的に補完する。
 */
export async function linkExpensesToSummary(
	notion: Client,
	dataSourceId: string,
	month: string,
	summaryPageId: string,
): Promise<{ linked: number; failed: number; truncated: boolean }> {
	const { start, endExclusive } = monthRange(month);

	const pages = await fetchDataSourcePages(
		notion,
		{
			data_source_id: dataSourceId,
			filter: {
				and: [
					{ property: "購入日", date: { on_or_after: start } },
					{ property: "購入日", date: { before: endExclusive } },
					{ property: "月次サマリ", relation: { is_empty: true } },
				],
			},
		},
		MAX_RELATION_LINKS_PER_RUN,
	);

	let linked = 0;
	let failed = 0;

	for (const page of pages) {
		try {
			await notion.pages.update({
				page_id: page.id,
				properties: { 月次サマリ: { relation: [{ id: summaryPageId }] } },
			});
			linked += 1;
		} catch (error) {
			// 1件失敗しても残りは繋ぐ。次回の実行で再度対象になる。
			log("warn", "expense_link_failed", { pageId: page.id, month, ...describeError(error) });
			failed += 1;
		}
	}

	// 上限に達した場合はまだ残っている可能性がある。次回の実行で続きを処理する。
	return { linked, failed, truncated: pages.length >= MAX_RELATION_LINKS_PER_RUN };
}

/** 走査するビューの上限。月ごとに1つ増えていくため、際限なく辿らないよう区切る。 */
const MAX_VIEWS_TO_SCAN = 200;

export type ExpenseViewStatus = "updated" | "unchanged" | "not_found";

/**
 * サマリページに置かれた支出DBのリンクドビューに、その月のフィルタをかける。
 *
 * グルーピング・ソート・列の計算（合計）はテンプレート側で設定済みで、
 * とくに「計算」は API から設定できない。そのため送るのは filter だけにして、
 * テンプレートで作り込んだ表示設定をそのまま活かす。
 * Notion のテンプレート機能では「その月だけ」の条件を作れないので、ここが穴埋めになる。
 */
export async function updateExpenseViewForMonth(
	notion: Client,
	dataSourceId: string,
	summaryPageId: string,
	month: string,
): Promise<ExpenseViewStatus> {
	const wrapperIds = await findLinkedDatabaseIds(notion, summaryPageId);
	if (wrapperIds.size === 0) {
		return "not_found";
	}

	// 表と円グラフのように同じページに複数置かれることがあるので、まとめて絞る。
	const views = await findViewsInDatabases(notion, dataSourceId, wrapperIds);
	if (views.length === 0) {
		return "not_found";
	}

	const { start, endExclusive } = monthRange(month);
	const stale = views.filter((view) => !viewCoversMonth(view.filter, start, endExclusive));
	if (stale.length === 0) {
		return "unchanged";
	}

	for (const view of stale) {
		await notion.views.update({
			view_id: view.id,
			// SDK の ViewFilterRequest は空オブジェクト型で、実際に受け付ける
			// データソースクエリと同じ形を表現できていないため、ここだけ型を通す。
			filter: {
				and: [
					{ property: "購入日", date: { on_or_after: start } },
					{ property: "購入日", date: { before: endExclusive } },
				],
			} as unknown as Record<string, never>,
		});
	}

	return "updated";
}

/**
 * ページ直下のリンクドDBブロックの id を集める。
 * リンクドビューは child_database ブロックとして現れ、その id がビューの親DBの id になる。
 */
async function findLinkedDatabaseIds(notion: Client, pageId: string): Promise<Set<string>> {
	const ids = new Set<string>();
	let cursor: string | undefined;

	do {
		const response = await notion.blocks.children.list({
			block_id: pageId,
			start_cursor: cursor,
			page_size: NOTION_PAGE_SIZE,
		});
		for (const block of response.results) {
			if ("type" in block && block.type === "child_database") {
				ids.add(normalizeId(block.id));
			}
		}
		cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
	} while (cursor);

	return ids;
}

/** 支出データソースのビューのうち、指定した親DBに属するものを集める。 */
async function findViewsInDatabases(
	notion: Client,
	dataSourceId: string,
	databaseIds: Set<string>,
): Promise<{ id: string; filter: unknown }[]> {
	const found: { id: string; filter: unknown }[] = [];
	let cursor: string | undefined;
	let scanned = 0;

	do {
		const response = await notion.views.list({
			data_source_id: dataSourceId,
			start_cursor: cursor,
			page_size: NOTION_PAGE_SIZE,
		});

		for (const reference of response.results) {
			if (scanned >= MAX_VIEWS_TO_SCAN) {
				return found;
			}
			scanned += 1;

			const view = await notion.views.retrieve({ view_id: reference.id });
			const parent = "parent" in view ? view.parent : undefined;
			const parentId = parent && "database_id" in parent ? normalizeId(parent.database_id) : undefined;

			if (parentId && databaseIds.has(parentId)) {
				found.push({ id: view.id, filter: "filter" in view ? view.filter : null });
			}
		}

		cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
	} while (cursor);

	return found;
}

/**
 * 既存フィルタが目的の月をそのまま表しているかを判定する。
 * Notion はフィルタをプロパティ名ではなく id で返すため、
 * プロパティを見ずに日付の境界だけで比べる。
 */
function viewCoversMonth(filter: unknown, start: string, endExclusive: string): boolean {
	const bounds = new Set<string>();

	const walk = (node: unknown) => {
		if (Array.isArray(node)) {
			for (const child of node) {
				walk(child);
			}
			return;
		}
		if (typeof node !== "object" || node === null) {
			return;
		}
		for (const value of Object.values(node)) {
			if (typeof value === "string") {
				bounds.add(value);
			} else {
				walk(value);
			}
		}
	};
	walk(filter);

	return bounds.has(start) && bounds.has(endExclusive);
}

function normalizeId(id: string): string {
	return id.replaceAll("-", "").toLowerCase();
}
