import { Hono } from "hono";
import type { AppEnv } from "../env";
import { todayInJst } from "../lib/date";
import { buildErrorBody, toFieldErrors } from "../lib/response";
import { apiKeyAuth } from "../middleware/auth";
import { buildCategoryKeywordMap, decideCategory } from "../services/category";
import { createNotionService } from "../services/notion";
import { expenseSchema } from "../validators/expense";

export const expensesRoute = new Hono<AppEnv>();

expensesRoute.use("*", apiKeyAuth);

expensesRoute.post("/", async (c) => {
	const requestId = c.get("requestId");

	const body = await c.req.json().catch(() => undefined);
	if (body === undefined) {
		return c.json(buildErrorBody("invalid_json", "リクエストボディが JSON として解釈できません。", requestId), 400);
	}

	const parsed = expenseSchema.safeParse(body);
	if (!parsed.success) {
		const errors = toFieldErrors(parsed.error);
		return c.json(
			buildErrorBody("validation_error", errors[0]?.message ?? "リクエストが不正です。", requestId, errors),
			400,
		);
	}

	const expense = parsed.data;
	// 購入日の入力を省けるよう、未指定なら JST の今日を補完する。
	const date = expense.date ?? todayInJst();

	const notionService = createNotionService({
		apiKey: c.env.NOTION_API_KEY,
		databaseId: c.env.NOTION_DATABASE_ID,
		dataSourceId: c.env.NOTION_DATASOURCE_ID,
		summaryDataSourceId: c.env.NOTION_SUMMARY_DATA_SOURCE_ID,
	});

	// カテゴリは自動決定に対応するため、リクエストに含まれないことを許容している。
	// リクエストにカテゴリが含まれない場合はここで決定する。
	const historyRecords = await notionService.fetchExpenseCategoryRecords();
	const keywordMap = buildCategoryKeywordMap(historyRecords);
	const category = expense.category ?? decideCategory(expense.name, keywordMap);

	// fetchSummaryIdByDate は getFullYear/getMonth（Workers では UTC）で月を判定するため、
	// 購入日を UTC 0時として渡す。JST 補正を掛けると月初が前月にずれる。
	const summaryPageId = await notionService.fetchSummaryIdByDate(new Date(`${date}T00:00:00Z`));
	const notionPage = await notionService.createExpensePage({ ...expense, date, category }, summaryPageId);

	return c.json({
		success: true,
		pageId: notionPage.id,
		url: notionPage.url,
		category,
		categorySource: expense.category ? "request" : "auto",
		expense: {
			name: expense.name,
			amount: expense.amount,
			paymentMethod: expense.paymentMethod,
			date,
			category,
		},
	});
});
