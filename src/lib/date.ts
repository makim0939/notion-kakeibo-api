/**
 * 日付ユーティリティ。
 * 家計簿の「今日」は利用者のいる JST 基準で判断する必要があるため、
 * Workers の UTC 時刻から JST に補正して扱う。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** JST における今日を YYYY-MM-DD で返す。 */
export function todayInJst(now: Date = new Date()): string {
	return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * YYYY-MM-DD 形式かつ実在する日付かを判定する。
 * 正規表現だけでは 2026-02-31 のような存在しない日付を通してしまうため、
 * Date に通した結果と突き合わせる。
 */
export function isValidDate(value: string): boolean {
	if (!DATE_PATTERN.test(value)) {
		return false;
	}

	const parsed = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
