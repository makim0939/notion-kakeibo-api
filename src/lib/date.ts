/**
 * 日付ユーティリティ。
 * 家計簿の「今日」「今月」は利用者のいる JST 基準で判断する必要があるため、
 * Workers の UTC 時刻から JST に補正して扱う。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

/** JST における今日を YYYY-MM-DD で返す。 */
export function todayInJst(now: Date = new Date()): string {
	return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** JST における今月を YYYY-MM で返す。 */
export function currentMonthInJst(now: Date = new Date()): string {
	return todayInJst(now).slice(0, 7);
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

/** YYYY-MM 形式かつ実在する月かを判定する。 */
export function isValidMonth(value: string): boolean {
	if (!MONTH_PATTERN.test(value)) {
		return false;
	}

	const month = Number(value.slice(5, 7));
	return month >= 1 && month <= 12;
}

/**
 * YYYY-MM から Notion の日付フィルタに使う範囲を返す。
 * 終端は「翌月1日より前」とし、月末日を意識せずに範囲指定できるようにしている。
 */
export function monthRange(month: string): { start: string; endExclusive: string } {
	const year = Number(month.slice(0, 4));
	const monthNumber = Number(month.slice(5, 7));

	const nextYear = monthNumber === 12 ? year + 1 : year;
	const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;

	return {
		start: `${month}-01`,
		endExclusive: `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`,
	};
}
