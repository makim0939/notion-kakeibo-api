import { Hono } from "hono";
import type { AppEnv, Bindings } from "../env";
import { buildErrorBody } from "../lib/response";
import { apiKeyAuth } from "../middleware/auth";
import { SummaryPageError } from "../services/notion";
import { createNotionServiceFromEnv, refreshSummaryPage } from "../services/summary-refresh";

/** Notion の id() はハイフン無しの32桁で返る。ハイフン付きも受け付ける。 */
const PAGE_ID_PATTERN = /^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const summaryRoute = new Hono<AppEnv>();

summaryRoute.use("*", apiKeyAuth);

/**
 * サマリページを今すぐ最新化する。
 * 通常は毎時の定期実行に任せればよく、これは待てない場合の手動トリガ。
 */
summaryRoute.post("/", async (c) => {
	const requestId = c.get("requestId");
	const body = await c.req.json().catch(() => undefined);
	const pageId = c.req.query("pageid") ?? extractPageId(body);

	if (!pageId || !PAGE_ID_PATTERN.test(pageId)) {
		return c.json(buildErrorBody("validation_error", "pageid が不正です。", requestId), 400);
	}

	try {
		const result = await refreshSummaryPage(createNotionServiceFromEnv(c.env as Bindings), pageId);
		return c.json({ success: true, ...result });
	} catch (error) {
		if (error instanceof SummaryPageError) {
			return c.json(buildErrorBody(error.code, error.message, requestId), 400);
		}
		throw error;
	}
});

/** ボディで渡された場合のページID。包まれている形も一応拾う。 */
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

	if (typeof record.data === "object" && record.data !== null) {
		return extractPageId(record.data);
	}

	return undefined;
}
