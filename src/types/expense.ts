export const PAYMENT_METHODS = ["カード", "現金"] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** 背面タップ経由など、支払い方法の指定がないリクエストで使う既定値。 */
export const DEFAULT_PAYMENT_METHOD: PaymentMethod = "カード";

/**
 * NotionDB「支出」のカテゴリ（セレクトの選択肢）。
 * リクエストで指定できるカテゴリはこの一覧に限定し、タイプミスで
 * Notion 側に新しい選択肢が増えるのを防いでいる。
 */
export const EXPENSE_CATEGORIES = [
	"日用・食費",
	"住居費",
	"生活費",
	"遊び費",
	"仕事勉強費",
	"旅行費",
	"特別費",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** どのカテゴリにも判定できなかった場合の値。 */
export const UNCATEGORIZED = "未分類";

/** 支出名の最大長。 */
export const EXPENSE_NAME_MAX_LENGTH = 200;

/** 金額の絶対値の上限。桁の打ち間違いを弾くためのガード。 */
export const EXPENSE_AMOUNT_MAX = 100_000_000;

export type ExpenseRequest = {
	name: string;
	amount: number;
	paymentMethod: PaymentMethod;
	date: string;
	category?: string;
};

export type CategoryHistoryRecord = {
	名前: string;
	カテゴリ: string;
};
