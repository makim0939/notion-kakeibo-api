import { z } from "zod";
import { isValidDate } from "../lib/date";
import {
	DEFAULT_PAYMENT_METHOD,
	EXPENSE_AMOUNT_MAX,
	EXPENSE_CATEGORIES,
	EXPENSE_NAME_MAX_LENGTH,
	PAYMENT_METHODS,
} from "../types/expense";

/**
 * 金額。OCR やショートカットからは "¥1,200" のような文字列で渡ることがあるため、
 * 記号・区切り・全角数字を落としてから数値として検証する。
 * 返金の記録に使えるよう負の値は許容し、0 と小数だけを弾く。
 */
const amountSchema = z.preprocess(
	(value) => {
		if (typeof value !== "string") {
			return value;
		}

		const normalized = value
			.normalize("NFKC")
			.replace(/[¥￥,\s]/g, "")
			.replace(/円$/, "");

		if (normalized === "") {
			return value;
		}

		const parsed = Number(normalized);
		return Number.isNaN(parsed) ? value : parsed;
	},
	z
		.number("amount must be a number")
		.int("amount must be an integer")
		.refine((amount) => amount !== 0, "amount must be not zero")
		.refine(
			(amount) => Math.abs(amount) <= EXPENSE_AMOUNT_MAX,
			`amount must be between -${EXPENSE_AMOUNT_MAX} and ${EXPENSE_AMOUNT_MAX}`,
		),
);

/** 購入日。YYYY/MM/DD 表記も受け付け、存在しない日付は弾く。 */
const dateSchema = z.preprocess(
	(value) => {
		if (typeof value !== "string") {
			return value;
		}
		return value.trim().normalize("NFKC").replace(/[/.]/g, "-");
	},
	z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
		.refine(isValidDate, "date must be an existing calendar date"),
);

/**
 * 支出登録リクエスト。
 * date と paymentMethod は省略可能で、省略時はサーバ側で補完する
 * （背面タップ経由のように入力ステップを削りたいケースがあるため）。
 */
export const expenseSchema = z.object({
	name: z
		.string("name is required")
		.trim()
		.min(1, "name is required")
		.max(EXPENSE_NAME_MAX_LENGTH, `name must be ${EXPENSE_NAME_MAX_LENGTH} characters or less`),

	amount: amountSchema,

	// クライアントは選択肢から送る想定なので、表記ゆれの吸収はしない。
	paymentMethod: z
		.enum(PAYMENT_METHODS, `paymentMethod must be one of: ${PAYMENT_METHODS.join(", ")}`)
		.optional()
		.default(DEFAULT_PAYMENT_METHOD),

	date: dateSchema.optional(),

	category: z.enum(EXPENSE_CATEGORIES, `category must be one of: ${EXPENSE_CATEGORIES.join(", ")}`).optional(),
});

export type ExpenseInput = z.infer<typeof expenseSchema>;
