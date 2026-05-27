import type { Bindings } from "../env";
import type { ExpenseRequest } from "../types/expense";

type NotionCreatePageResponse = {
	id: string;
};

export type NotionExpenseRecord = {
	name: string;
	category: string;
};

export async function createExpensePage(
	expense: ExpenseRequest,
	env: Bindings,
): Promise<NotionCreatePageResponse> {
	const response = await fetch("https://api.notion.com/v1/pages", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${env.NOTION_API_KEY}`,
			"Content-Type": "application/json",
			"Notion-Version": "2022-06-28",
		},
		body: JSON.stringify({
			parent: {
				database_id: env.NOTION_DATABASE_ID,
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
		}),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(text);
	}

	return response.json() as Promise<NotionCreatePageResponse>;
}

export async function fetchExpenseCategoryRecords(
	env: Bindings,
): Promise<NotionExpenseRecord[]> {
	if (!env.NOTION_API_KEY || !env.NOTION_DATABASE_ID) {
		return [];
	}

	const url = `https://api.notion.com/v1/databases/${env.NOTION_DATABASE_ID}/query`;
	const records: NotionExpenseRecord[] = [];
	let startCursor: string | undefined;

	while (true) {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.NOTION_API_KEY}`,
				"Content-Type": "application/json",
				"Notion-Version": "2022-06-28",
			},
			body: JSON.stringify({
				page_size: 100,
				start_cursor: startCursor,
			}),
		});

		if (!response.ok) {
			return [];
		}

		const data = await response.json();
		const results =
			isObject(data) && Array.isArray(data.results) ? data.results : [];

		for (const page of results) {
			const name = extractPageTitle(page);
			const category = extractPageCategory(page);

			if (!name || !category) {
				continue;
			}

			records.push({ name, category });
		}

		if (!isObject(data) || data.has_more !== true) {
			break;
		}

		startCursor =
			typeof data.next_cursor === "string" ? data.next_cursor : undefined;
	}

	return records;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function extractPageTitle(page: unknown): string | undefined {
	if (!isObject(page)) {
		return undefined;
	}

	const properties = page.properties;
	if (!isObject(properties)) {
		return undefined;
	}

	const nameProperty = properties.名前;
	if (!isObject(nameProperty) || !Array.isArray(nameProperty.title)) {
		return undefined;
	}

	const titleArray = nameProperty.title;
	return (
		titleArray
			.map((part) => {
				if (!isObject(part)) {
					return "";
				}
				if (typeof part.plain_text === "string") {
					return part.plain_text;
				}
				if (isObject(part.text) && typeof part.text.content === "string") {
					return part.text.content;
				}
				return "";
			})
			.join("")
			.trim() || undefined
	);
}

function extractPageCategory(page: unknown): string | undefined {
	if (!isObject(page)) {
		return undefined;
	}

	const properties = page.properties;
	if (!isObject(properties)) {
		return undefined;
	}

	const categoryProperty = properties.カテゴリ;
	if (!isObject(categoryProperty)) {
		return undefined;
	}

	const selectProperty = categoryProperty.select;
	if (!isObject(selectProperty) || typeof selectProperty.name !== "string") {
		return undefined;
	}

	return selectProperty.name;
}
