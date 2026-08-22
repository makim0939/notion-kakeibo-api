import { Hono } from "hono";
import type { AppEnv } from "../env";
import { todayInJst } from "../lib/date";
import { describeError, log } from "../lib/log";
import { buildErrorBody, toFieldErrors } from "../lib/response";
import { apiKeyAuth } from "../middleware/auth";
import { buildCategoryIndex, decideCategory } from "../services/category";
import { createNotionService } from "../services/notion";
import { expenseSchema } from "../validators/expense";

/**
 * カテゴリ学習に使う履歴の件数。
 * DB 全件を舐めると登録が件数に比例して遅くなるため、直近ぶんだけを見る。
 */
const CATEGORY_HISTORY_LIMIT = 300;

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
	// 指定がある場合は履歴を引かずにそのまま使う（無駄な Notion 呼び出しを避ける）。
	const category = expense.category ?? (await autoCategory(notionService, expense.name, requestId));

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

/**
 * 支出名からカテゴリを推定する。
 * 履歴の取得に失敗しても登録自体は通したいので、静的キーワードだけで判定する
 * フォールバックに切り替える。
 */
async function autoCategory(
	notionService: ReturnType<typeof createNotionService>,
	name: string,
	requestId: string,
): Promise<string> {
	try {
		const history = await notionService.fetchExpenseCategoryRecords(CATEGORY_HISTORY_LIMIT);
		return decideCategory(name, buildCategoryIndex(history));
	} catch (error) {
		log("warn", "category_history_unavailable", { requestId, ...describeError(error) });
		return decideCategory(name, buildCategoryIndex([]));
	}
}
