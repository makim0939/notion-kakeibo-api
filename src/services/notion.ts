import type { PageObjectResponse, QueryDataSourceResponse } from "@notionhq/client";
import { Client } from "@notionhq/client";
import type { CategoryHistoryRecord, ExpenseRequest } from "../types/expense";
import { UNCATEGORIZED } from "../types/expense";

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
		fetchExpenseCategoryRecords: () => fetchExpenseCategoryRecords(notion, dataSourceId),
		fetchSummaryIdByDate: (date: Date) => fetchSummaryIdByDate(notion, summaryDataSourceId, date),
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

export async function fetchExpenseCategoryRecords(
	notion: Client,
	dataSourceId: string,
): Promise<CategoryHistoryRecord[]> {
	const shape = {
		名前: "title",
		カテゴリ: "select",
	} as const;

	const pages = await fetchDataSourcePages(notion, {
		data_source_id: dataSourceId,
		filter_properties: Object.keys(shape),
		filter: {
			property: "カテゴリ",
			select: { does_not_equal: UNCATEGORIZED },
		},
	});

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
	const shape = {
		日付: "date",
	} as const;

	const year = date.getFullYear();
	const month = date.getMonth() + 1;
	const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
	const endDate = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
	const pages = await fetchDataSourcePages(notion, {
		data_source_id: dataSourceId,
		filter_properties: Object.keys(shape),
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

async function fetchDataSourcePages(
	notion: Client,
	params: Omit<Parameters<Client["dataSources"]["query"]>[0], "start_cursor">,
): Promise<PageObjectResponse[]> {
	const pages: PageObjectResponse[] = [];
	let hasMore = true;
	let startCursor: string | undefined;

	while (hasMore) {
		const response = await notion.dataSources.query({
			...params,
			start_cursor: startCursor,
		});

		pages.push(...response.results.filter(isFullPage));

		hasMore = response.has_more;
		startCursor = response.next_cursor ?? undefined;
	}

	return pages;
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
