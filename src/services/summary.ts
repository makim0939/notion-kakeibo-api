import type { ExpenseRecord } from "../types/expense";

export type Breakdown = {
	key: string;
	total: number;
	count: number;
	/** 総支出に占める割合（小数第1位まで、%）。 */
	ratio: number;
};

export type MonthlySummary = {
	total: number;
	count: number;
	byCategory: Breakdown[];
	byPaymentMethod: Breakdown[];
};

/** 月次の支出を、カテゴリ別・支払い方法別に集計する。 */
export function summarize(records: ExpenseRecord[]): MonthlySummary {
	const total = records.reduce((sum, record) => sum + record.amount, 0);

	return {
		total,
		count: records.length,
		byCategory: breakdown(records, total, (record) => record.category),
		byPaymentMethod: breakdown(records, total, (record) => record.paymentMethod ?? "未設定"),
	};
}

function breakdown(records: ExpenseRecord[], total: number, keyOf: (record: ExpenseRecord) => string): Breakdown[] {
	const totals = new Map<string, { total: number; count: number }>();

	for (const record of records) {
		const key = keyOf(record);
		const current = totals.get(key) ?? { total: 0, count: 0 };
		current.total += record.amount;
		current.count += 1;
		totals.set(key, current);
	}

	return Array.from(totals, ([key, value]) => ({
		key,
		total: value.total,
		count: value.count,
		ratio: total === 0 ? 0 : Math.round((value.total / total) * 1000) / 10,
	})).sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}
