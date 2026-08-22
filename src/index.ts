import { APIResponseError, isNotionClientError, RequestTimeoutError } from "@notionhq/client";
import { Hono } from "hono";
import type { AppEnv } from "./env";
import { describeError, log } from "./lib/log";
import { buildErrorBody } from "./lib/response";
import { apiKeyAuth } from "./middleware/auth";
import { requestContext } from "./middleware/request-context";
import { expensesRoute } from "./routes/expenses";
import { summaryRoute } from "./routes/summary";
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

export default app;
