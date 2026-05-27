import { Hono } from "hono";
import type { Bindings } from "../env";
import { buildCategoryKeywordMap, decideCategory } from "../services/category";
import {
	createExpensePage,
	fetchExpenseCategoryRecords,
} from "../services/notion";
import { expenseSchema } from "../validators/expense";

export const expensesRoute = new Hono<{ Bindings: Bindings }>();

expensesRoute.post("/", async (c) => {
	try {
		const body = await c.req.json();
		const parsed = expenseSchema.safeParse(body);

		if (!parsed.success) {
			return c.json(
				{
					success: false,
					message: parsed.error.issues[0]?.message,
				},
				400,
			);
		}

		const expense = parsed.data;

		// カテゴリは自動決定に対応するため、リクエストに含まれないことを許容している。
		// リクエストにカテゴリが含まれない場合はここで決定する。
		const historyRecords = await fetchExpenseCategoryRecords(c.env);
		const keywordMap = buildCategoryKeywordMap(historyRecords);
		const category =
			expense.category ?? decideCategory(expense.name, keywordMap);

		const notionPage = await createExpensePage(
			{
				...expense,
				category,
			},
			c.env,
		);

		return c.json({
			success: true,
			pageId: notionPage.id,
			category,
		});
	} catch (error) {
		return c.json(
			{
				success: false,
				message:
					error instanceof Error ? error.message : "Internal Server Error",
			},
			500,
		);
	}
});
