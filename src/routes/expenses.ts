import { Hono } from "hono";
import type { Bindings } from "../env";
import { buildCategoryKeywordMap, decideCategory } from "../services/category";
import { createNotionService } from "../services/notion";
import { expenseSchema } from "../validators/expense";

export const expensesRoute = new Hono<{ Bindings: Bindings }>();

expensesRoute.post("/", async (c) => {
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

	const notionService = createNotionService({
		apiKey: c.env.NOTION_API_KEY,
		databaseId: c.env.NOTION_DATABASE_ID,
		dataSourceId: c.env.NOTION_DATASOURCE_ID,
	});

	// カテゴリは自動決定に対応するため、リクエストに含まれないことを許容している。
	// リクエストにカテゴリが含まれない場合はここで決定する。
	const historyRecords = await notionService.fetchExpenseCategoryRecords();
	const keywordMap = buildCategoryKeywordMap(historyRecords);
	const category = expense.category ?? decideCategory(expense.name, keywordMap);

	const notionPage = await notionService.createExpensePage({ ...expense, category });

	return c.json({
		success: true,
		pageId: notionPage.id,
		category,
	});
});
