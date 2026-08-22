/**
 * カテゴリ判定や金額パースで使う文字列の正規化。
 * 「ﾌｧﾐﾏ」「ファミマ」「ＦＡＭＩＭＡ」のような表記ゆれを吸収する。
 */
export function normalizeText(value: string): string {
	return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

/**
 * 空白・カンマ・中黒などの区切りで支出名を語に分ける。
 * 「スタバ ラテ」のように複数の語からなる支出名を、語単位で学習・照合するために使う。
 */
export function tokenize(value: string): string[] {
	return value
		.normalize("NFKC")
		.toLowerCase()
		.split(/[\s,、･・/|]+/)
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
}
