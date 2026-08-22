import type { BlockObjectRequest, PageObjectResponse, QueryDataSourceResponse } from "@notionhq/client";
import { Client } from "@notionhq/client";
import type { CategoryHistoryRecord, ExpenseRequest } from "../types/expense";
import { UNCATEGORIZED } from "../types/expense";
import type { SummaryValues } from "../types/summary";
import { ACHIEVED_MARK, SUMMARY_PROPERTY } from "../types/summary";
import { buildSectionCallout, MANAGED_SECTION_PREFIX } from "./summary-page";

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
		replaceSummarySection: (pageId: string, blocks: BlockObjectRequest[], heading: string) =>
			replaceSummarySection(notion, pageId, blocks, heading),
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

/**
 * 自動生成セクションを最新の内容に差し替える。
 * 目印のコールアウトがあればその子ブロックだけを作り直し、無ければページ末尾に新規作成する。
 * ユーザが書いた既存ブロックには一切触れない。
 */
export async function replaceSummarySection(
	notion: Client,
	pageId: string,
	blocks: BlockObjectRequest[],
	heading: string,
): Promise<{ created: boolean; sectionId: string }> {
	const existing = await findManagedSection(notion, pageId);

	if (existing) {
		await notion.blocks.update({
			block_id: existing,
			callout: { rich_text: [{ text: { content: heading } }] },
		});
		await deleteChildren(notion, existing);
		await appendInChunks(notion, existing, blocks);
		return { created: false, sectionId: existing };
	}

	const appended = await notion.blocks.children.append({
		block_id: pageId,
		children: [buildSectionCallout(heading)],
	});

	const sectionId = appended.results[0]?.id;
	if (!sectionId) {
		throw new SummaryPageError("summary_section_failed", "サマリセクションを作成できませんでした。");
	}

	await appendInChunks(notion, sectionId, blocks);
	return { created: true, sectionId };
}

/** ページ直下から、自動生成セクションの目印コールアウトを探す。 */
async function findManagedSection(notion: Client, pageId: string): Promise<string | undefined> {
	let cursor: string | undefined;

	do {
		const response = await notion.blocks.children.list({
			block_id: pageId,
			start_cursor: cursor,
			page_size: NOTION_PAGE_SIZE,
		});

		for (const block of response.results) {
			if (!("type" in block) || block.type !== "callout") {
				continue;
			}
			const text = block.callout.rich_text.map((part) => part.plain_text).join("");
			if (text.startsWith(MANAGED_SECTION_PREFIX)) {
				return block.id;
			}
		}

		cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
	} while (cursor);

	return undefined;
}

async function deleteChildren(notion: Client, blockId: string): Promise<void> {
	const ids: string[] = [];
	let cursor: string | undefined;

	do {
		const response = await notion.blocks.children.list({
			block_id: blockId,
			start_cursor: cursor,
			page_size: NOTION_PAGE_SIZE,
		});
		ids.push(...response.results.map((block) => block.id));
		cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
	} while (cursor);

	// 並列で消すとレート制限に当たりやすいので順番に消す。
	for (const id of ids) {
		await notion.blocks.delete({ block_id: id });
	}
}

/** append は1リクエスト100ブロックまでなので分割して送る。 */
async function appendInChunks(notion: Client, blockId: string, blocks: BlockObjectRequest[]): Promise<void> {
	for (let index = 0; index < blocks.length; index += NOTION_PAGE_SIZE) {
		await notion.blocks.children.append({
			block_id: blockId,
			children: blocks.slice(index, index + NOTION_PAGE_SIZE),
		});
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
