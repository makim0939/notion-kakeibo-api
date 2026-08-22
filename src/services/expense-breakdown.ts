import type { MonthlyExpense } from "../types/expense";

export type CategoryBreakdown = {
	category: string;
	total: number;
	count: number;
	/** 当月の総支出に占める割合（小数第1位まで、%）。 */
	ratio: number;
	/** 前月の同カテゴリの合計。前月に実績が無ければ null。 */
	previousTotal: number | null;
	/** 前月からの増減。前月の実績が無ければ null。 */
	delta: number | null;
};

export type CategoryGroup = {
	category: string;
	total: number;
	/** 金額の大きい順。 */
	items: MonthlyExpense[];
};

export type ExpenseBreakdown = {
	total: number;
	count: number;
	rows: CategoryBreakdown[];
	groups: CategoryGroup[];
	/** 積立投資の合計。支出には含めない。実績が無ければ null。 */
	investment: number | null;
	/** 取得上限に達して一部しか読めていない場合に true。 */
	truncated: boolean;
};

/**
 * 資産の移動であって消費ではないカテゴリ。
 * サマリページの「🔴総支出」も同じ考えでこれを除いているので、
 * こちらの集計も揃えて、同じページに違う総額が並ばないようにする。
 */
const NON_EXPENSE_CATEGORY = "投資";

/**
 * 支出をカテゴリ別に集計する。
 * 前月分を渡すと、カテゴリごとの増減も出す。
 */
export function breakdownExpenses(
	current: MonthlyExpense[],
	previous: MonthlyExpense[] = [],
	truncated = false,
): ExpenseBreakdown {
	const investmentItems = current.filter((expense) => expense.category === NON_EXPENSE_CATEGORY);
	const spent = current.filter((expense) => expense.category !== NON_EXPENSE_CATEGORY);

	const total = sum(spent);
	const currentTotals = totalsByCategory(spent);
	const previousTotals = totalsByCategory(previous.filter((e) => e.category !== NON_EXPENSE_CATEGORY));

	const rows: CategoryBreakdown[] = Array.from(currentTotals, ([category, value]) => {
		const previousTotal = previousTotals.get(category)?.total ?? null;
		return {
			category,
			total: value.total,
			count: value.count,
			ratio: total === 0 ? 0 : Math.round((value.total / total) * 1000) / 10,
			previousTotal,
			delta: previousTotal === null ? null : value.total - previousTotal,
		};
	}).sort(byTotalDesc);

	const groups: CategoryGroup[] = rows.map((row) => ({
		category: row.category,
		total: row.total,
		items: spent
			.filter((expense) => expense.category === row.category)
			.sort((a, b) => b.amount - a.amount || (a.date ?? "").localeCompare(b.date ?? "")),
	}));

	return {
		total,
		count: spent.length,
		rows,
		groups,
		investment: investmentItems.length === 0 ? null : sum(investmentItems),
		truncated,
	};
}

function totalsByCategory(expenses: MonthlyExpense[]): Map<string, { total: number; count: number }> {
	const totals = new Map<string, { total: number; count: number }>();

	for (const expense of expenses) {
		const current = totals.get(expense.category) ?? { total: 0, count: 0 };
		current.total += expense.amount;
		current.count += 1;
		totals.set(expense.category, current);
	}

	return totals;
}

function byTotalDesc(a: CategoryBreakdown, b: CategoryBreakdown): number {
	return b.total - a.total || a.category.localeCompare(b.category);
}

function sum(expenses: MonthlyExpense[]): number {
	return expenses.reduce((acc, expense) => acc + expense.amount, 0);
}
