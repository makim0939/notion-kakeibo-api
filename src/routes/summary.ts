import { Hono } from "hono";
import type { AppEnv, Bindings } from "../env";
import { nowInJst } from "../lib/date";
import { buildErrorBody } from "../lib/response";
import { createApiKeyAuth } from "../middleware/auth";
import { createNotionService, SummaryPageError } from "../services/notion";
import { buildSectionHeading, renderSummaryBlocks } from "../services/summary-page";

/** Notion の id() はハイフン無しの32桁で返る。ハイフン付きも受け付ける。 */
const PAGE_ID_PATTERN = /^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const summaryRoute = new Hono<AppEnv>();

// Notion の数式プロパティが出す URL はブラウザで開く形になり、
// リクエストヘッダを付けられないので ?key= でも認証できるようにしている。
summaryRoute.use("*", createApiKeyAuth({ allowQueryParam: true }));

/** ブラウザから開かれる想定。結果を人が読める HTML で返す。 */
summaryRoute.get("/", async (c) => {
	const requestId = c.get("requestId");
	const pageId = c.req.query("pageid");

	if (!pageId || !PAGE_ID_PATTERN.test(pageId)) {
		return c.html(errorPage("pageid が不正です。", requestId), 400);
	}

	try {
		const result = await updateSummary(c.env, pageId);
		return c.html(successPage(result));
	} catch (error) {
		if (error instanceof SummaryPageError) {
			return c.html(errorPage(error.message, requestId), 400);
		}
		throw error;
	}
});

/** プログラムから叩く用。Notion のボタン Webhook（有料プラン）もここに向けられる。 */
summaryRoute.post("/", async (c) => {
	const requestId = c.get("requestId");
	const body = await c.req.json().catch(() => undefined);
	const pageId = c.req.query("pageid") ?? extractPageId(body);

	if (!pageId || !PAGE_ID_PATTERN.test(pageId)) {
		return c.json(buildErrorBody("validation_error", "pageid が不正です。", requestId), 400);
	}

	try {
		const result = await updateSummary(c.env, pageId);
		return c.json({ success: true, ...result });
	} catch (error) {
		if (error instanceof SummaryPageError) {
			return c.json(buildErrorBody(error.code, error.message, requestId), 400);
		}
		throw error;
	}
});

async function updateSummary(env: Bindings, pageId: string) {
	const notionService = createNotionService({
		apiKey: env.NOTION_API_KEY,
		databaseId: env.NOTION_DATABASE_ID,
		dataSourceId: env.NOTION_DATASOURCE_ID,
		summaryDataSourceId: env.NOTION_SUMMARY_DATA_SOURCE_ID,
	});

	const values = await notionService.fetchSummaryValues(pageId);
	const updatedAt = nowInJst();
	const { created } = await notionService.replaceSummarySection(
		pageId,
		renderSummaryBlocks(values),
		buildSectionHeading(updatedAt),
	);

	return { pageId, title: values.title, month: values.date?.slice(0, 7) ?? null, created, updatedAt };
}

/** Notion のボタン Webhook はページのプロパティを含む JSON を POST してくる。 */
function extractPageId(body: unknown): string | undefined {
	if (typeof body !== "object" || body === null) {
		return undefined;
	}

	const record = body as Record<string, unknown>;
	for (const key of ["pageid", "pageId", "page_id", "id"]) {
		const value = record[key];
		if (typeof value === "string") {
			return value.replaceAll("-", "");
		}
	}

	// { data: { id: ... } } のように包まれている場合に備える。
	if (typeof record.data === "object" && record.data !== null) {
		return extractPageId(record.data);
	}

	return undefined;
}

function page(title: string, body: string): string {
	return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
:root{color-scheme:light dark}
body{font-family:system-ui,-apple-system,"Hiragino Sans",sans-serif;margin:0;
display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.card{max-width:32rem;width:100%;text-align:center;line-height:1.8}
h1{font-size:1.25rem;margin:0 0 .75rem}
p{margin:.25rem 0;opacity:.85}
.hint{margin-top:1.5rem;font-size:.875rem;opacity:.6}
</style></head><body><div class="card">${body}</div></body></html>`;
}

function successPage(result: Awaited<ReturnType<typeof updateSummary>>): string {
	return page(
		"サマリを更新しました",
		`<h1>✅ サマリを更新しました</h1>
<p>${escapeHtml(result.title || result.pageId)}</p>
<p>${result.created ? "サマリセクションを新しく作成しました。" : "サマリセクションを最新の内容に更新しました。"}</p>
<p class="hint">最終更新 ${escapeHtml(result.updatedAt)} / このタブは閉じて Notion に戻ってください。</p>`,
	);
}

function errorPage(message: string, requestId: string): string {
	return page(
		"サマリを更新できませんでした",
		`<h1>⚠️ サマリを更新できませんでした</h1>
<p>${escapeHtml(message)}</p>
<p class="hint">requestId: ${escapeHtml(requestId)}</p>`,
	);
}

function escapeHtml(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
