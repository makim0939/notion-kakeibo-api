type LogLevel = "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

/**
 * 構造化ログを1行のJSONで出力する。
 * Cloudflare のログ検索でフィールド単位に絞り込めるようにするため、
 * console へ文字列連結するのではなくJSONで揃えている。
 */
export function log(level: LogLevel, event: string, fields: LogFields = {}) {
	const entry = JSON.stringify({ level, event, time: new Date().toISOString(), ...fields });

	if (level === "error") {
		console.error(entry);
		return;
	}
	if (level === "warn") {
		console.warn(entry);
		return;
	}
	console.log(entry);
}

/** エラーオブジェクトからログに載せる情報だけを取り出す。 */
export function describeError(error: unknown): LogFields {
	if (error instanceof Error) {
		return { errorName: error.name, errorMessage: error.message, stack: error.stack };
	}

	return { errorMessage: String(error) };
}
