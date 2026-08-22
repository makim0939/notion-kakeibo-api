import { APIResponseError, isNotionClientError, RequestTimeoutError } from "@notionhq/client";
import { Hono } from "hono";
import type { AppEnv, Bindings } from "./env";
import { describeError, log } from "./lib/log";
import { buildErrorBody } from "./lib/response";
import { apiKeyAuth } from "./middleware/auth";
import { requestContext } from "./middleware/request-context";
import { expensesRoute } from "./routes/expenses";
import { summaryRoute } from "./routes/summary";
import { createNotionServiceFromEnv, refreshRecentSummaries } from "./services/summary-refresh";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, UNCATEGORIZED } from "./types/expense";

const app = new Hono<AppEnv>();

app.use("*", requestContext);

// 疎通確認用。監視から叩けるよう認証は不要にしている。
app.get("/", (c) => c.text("OK"));
app.get("/health", (c) => c.json({ status: "ok" }));

// ショートカット側で選択肢を組み立てられるように、受け付ける値を返す。
app.get("/categories", apiKeyAuth, (c) =>
	c.json({
		success: true,
		categories: EXPENSE_CATEGORIES,
		uncategorized: UNCATEGORIZED,
		paymentMethods: PAYMENT_METHODS,
	}),
);

app.route("/expenses", expensesRoute);
app.route("/summary", summaryRoute);

app.notFound((c) => c.json(buildErrorBody("not_found", "エンドポイントが存在しません。", c.get("requestId")), 404));

app.onError((err, c) => {
	const requestId = c.get("requestId");

	if (isNotionClientError(err)) {
		// Notion のメッセージには内部情報が載りうるのでログにだけ残す。
		log("error", "notion_api_error", { requestId, notionCode: err.code, ...describeError(err) });

		const rateLimited = err instanceof APIResponseError && err.status === 429;
		const timedOut = err instanceof RequestTimeoutError;

		return c.json(
			{
				...buildErrorBody(
					"notion_error",
					rateLimited
						? "Notion API の制限により処理できませんでした。時間をおいて再試行してください。"
						: "Notion API との連携に失敗しました。",
					requestId,
				),
				// 原因の切り分け用。Notion のエラーコードで、機密情報は含まない。
				notionCode: err.code,
			},
			rateLimited || timedOut ? 503 : 502,
		);
	}

	log("error", "unhandled_error", { requestId, ...describeError(err) });

	return c.json(buildErrorBody("internal_error", "サーバ内部でエラーが発生しました。", requestId), 500);
});

/**
 * 定期実行。今月と前月のサマリページを最新化する。
 * 内容が変わっていなければ何も書かないので、頻繁に走っても
 * Notion の更新履歴は汚れない。手動更新（GET /summary）を待たずに
 * 「後から資産額を記入した」ケースを拾える。
 */
async function scheduled(event: ScheduledController, env: Bindings) {
	const startedAt = Date.now();

	try {
		const results = await refreshRecentSummaries(createNotionServiceFromEnv(env));

		log("info", "summary_cron", {
			cron: event.cron,
			durationMs: Date.now() - startedAt,
			total: results.length,
			changed: results.filter((result) => result.status !== "unchanged").length,
			pages: results.map((result) => ({ month: result.month, status: result.status })),
		});
	} catch (error) {
		log("error", "summary_cron_failed", { cron: event.cron, ...describeError(error) });
	}
}

export default {
	fetch: app.fetch,
	scheduled,
};
