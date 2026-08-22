import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { log } from "../lib/log";

/**
 * リクエストごとに ID を払い出し、アクセスログを出す。
 * レスポンスにも X-Request-Id を載せるので、ショートカット側で受け取った ID から
 * Cloudflare のログを引ける。
 */
export const requestContext: MiddlewareHandler<AppEnv> = async (c, next) => {
	const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
	c.set("requestId", requestId);
	c.header("X-Request-Id", requestId);

	const startedAt = Date.now();
	await next();

	log("info", "request", {
		requestId,
		method: c.req.method,
		path: new URL(c.req.url).pathname,
		status: c.res.status,
		durationMs: Date.now() - startedAt,
	});
};
