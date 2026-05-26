import type { ExpenseRequest } from "../types/expense";
import type { Bindings } from "../env";

export async function createExpensePage(
	expense: ExpenseRequest,
	env: Bindings,
) {
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
					title: [
						{
							text: {
								content: expense.name,
							},
						},
					],
				},
				金額: {
					number: expense.amount,
				},
				支払い方法: {
					select: {
						name: expense.paymentMethod,
					},
				},
				購入日: {
					date: {
						start: expense.date,
					},
				},
				カテゴリ: {
					select: {
						name: expense.category ?? "未分類",
					},
				},
			},
		}),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(text);
	}

	return response.json<any>();
}
