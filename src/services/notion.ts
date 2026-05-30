import type { PageObjectResponse, QueryDataSourceResponse } from "@notionhq/client";
import { Client } from "@notionhq/client";
import type { CategoryHistoryRecord, ExpenseRequest } from "../types/expense";

type PageProperty = PageObjectResponse["properties"][string];

type CategoryHistoryProperties = {
	名前: Extract<PageProperty, { type: "title" }>;
	カテゴリ: Extract<PageProperty, { type: "select" }>;
};

type QueryDataSourceResult = QueryDataSourceResponse["results"][number];

type NotionServiceConfig = {
	apiKey: string;
	databaseId: string;
	dataSourceId: string;
};

type NotionCreatePageResponse = {
	id: string;
};

export function createNotionService(config: NotionServiceConfig) {
	const notion = new Client({ auth: config.apiKey });
	const databaseId = config.databaseId;
	const dataSourceId = config.dataSourceId;

	return {
		createExpensePage: (expense: ExpenseRequest) => createExpensePage(notion, databaseId, expense),
		fetchExpenseCategoryRecords: () => fetchExpenseCategoryRecords(notion, dataSourceId),
	};
}

export async function createExpensePage(
	notion: Client,
	databaseId: string,
	expense: ExpenseRequest,
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
			カテゴリ: { select: { name: expense.category ?? "未分類" } },
		},
	});

	return { id: response.id };
}

export async function fetchExpenseCategoryRecords(
	notion: Client,
	dataSourceId: string,
): Promise<CategoryHistoryRecord[]> {
	const records: CategoryHistoryRecord[] = [];
	let hasMore = true;
	let startCursor: string | undefined;

	while (hasMore) {
		const response = await notion.dataSources.query({
			data_source_id: dataSourceId,
			start_cursor: startCursor,
			filter_properties: ["名前", "カテゴリ"],
			filter: {
				property: "カテゴリ",
				select: { does_not_equal: "未分類" },
			},
		});

		const categories = response.results.flatMap((page) => {
			if (isFullPage(page) && hasCategoryHistoryProperties(page.properties)) {
				if (!page.properties.名前.title.length || !page.properties.カテゴリ.select) return [];

				return {
					名前: page.properties.名前.title[0]?.plain_text,
					カテゴリ: page.properties.カテゴリ.select.name,
				};
			}
			return [];
		});

		records.push(...categories);

		hasMore = response.has_more;
		startCursor = response.next_cursor ?? undefined;
	}
	return records;
}

function isFullPage(page: QueryDataSourceResult): page is PageObjectResponse {
	return "properties" in page;
}

function hasCategoryHistoryProperties(
	properties: PageObjectResponse["properties"],
): properties is CategoryHistoryProperties {
	return properties["名前"]?.type === "title" && properties["カテゴリ"]?.type === "select";
}
