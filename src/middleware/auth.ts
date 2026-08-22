import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { log } from "../lib/log";
import { buildErrorBody } from "../lib/response";

/**
 * API キー認証。
 * `X-API-Key: <key>` もしくは `Authorization: Bearer <key>` を受け付ける。
 *
 * API_KEY が未設定のときは通さずに 500 を返す。設定漏れのまま
 * 「URL を知っていれば誰でも書き込める」状態になるのを避けるため。
 */
export const apiKeyAuth: MiddlewareHandler<AppEnv> = createApiKeyAuth();

/**
 * `allowQueryParam` を立てると `?key=` でも受け付ける。
 * Notion の数式プロパティが出す URL をブラウザで開く経路は
 * リクエストヘッダを付けられないため、そこだけで使う。
 */
export function createApiKeyAuth(options: { allowQueryParam?: boolean } = {}): MiddlewareHandler<AppEnv> {
	return async (c, next) => {
		const requestId = c.get("requestId");
		const expected = c.env.API_KEY;

		if (!expected) {
			log("error", "api_key_not_configured", { requestId });
			return c.json(buildErrorBody("server_misconfigured", "サーバの設定が不足しています。", requestId), 500);
		}

		const provided = extractApiKey(c.req.header()) ?? (options.allowQueryParam ? c.req.query("key") : undefined);

		if (!provided || !(await isSameSecret(provided, expected))) {
			log("warn", "unauthorized", {
				requestId,
				path: new URL(c.req.url).pathname,
				hasCredential: Boolean(provided),
			});
			return c.json(buildErrorBody("unauthorized", "認証に失敗しました。", requestId), 401);
		}

		await next();
	};
}

function extractApiKey(headers: Record<string, string>): string | undefined {
	const apiKeyHeader = headers["x-api-key"];
	if (apiKeyHeader) {
		return apiKeyHeader.trim();
	}

	const authorization = headers.authorization;
	if (authorization?.toLowerCase().startsWith("bearer ")) {
		return authorization.slice("bearer ".length).trim();
	}

	return undefined;
}

/**
 * 秘密情報の比較。
 * 先頭一致の早期 return による所要時間の差から鍵を推測されないよう、
 * 同じ長さになる SHA-256 ダイジェスト同士を全バイト比較する。
 */
async function isSameSecret(a: string, b: string): Promise<boolean> {
	const [digestA, digestB] = await Promise.all([sha256(a), sha256(b)]);

	let diff = 0;
	for (let i = 0; i < digestA.length; i++) {
		diff |= digestA[i] ^ digestB[i];
	}

	return diff === 0;
}

async function sha256(value: string): Promise<Uint8Array> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return new Uint8Array(digest);
}
