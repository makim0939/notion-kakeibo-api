/**
 * NotionDB「家計簿」（月次サマリ）のプロパティ名。
 * 絵文字や空白もキーの一部なので、Notion 側の表示名と1文字でも違うと読めない。
 */
export const SUMMARY_PROPERTY = {
	title: "名前",
	date: "日付",
	totalAssets: "💰総資産",
	previousTotalAssets: "前月の総資産",
	savings: "🌰貯金資産",
	previousSavings: "前月の貯金資産",
	investment: "📊投資資産",
	previousInvestment: "前月の投資資産",
	income: "🟢総収入",
	expense: "🔴総支出",
	// 「📌 貯金目標」は絵文字のあとに半角スペースが入る。
	savingsGoal: "📌 貯金目標",
	expenseGoal: "📌支出目標",
	investmentGoal: "📌投資目標",
	discretionaryExpense: "🛒住食以外費",
	savingsGoalAchieved: "⛳️貯金目標達成したか",
	expenseGoalAchieved: "⛳️支出目標達成したか",
} as const;

/** 目標達成を表す「⛳️〜達成したか」数式の値。 */
export const ACHIEVED_MARK = "⭕";

/** サマリページから読み出した、描画に必要な値。 */
export type SummaryValues = {
	title: string;
	/** YYYY-MM-DD。日付未設定なら null。 */
	date: string | null;
	totalAssets: number | null;
	previousTotalAssets: number | null;
	savings: number | null;
	previousSavings: number | null;
	investment: number | null;
	previousInvestment: number | null;
	income: number | null;
	expense: number | null;
	discretionaryExpense: number | null;
	savingsGoal: number | null;
	expenseGoal: number | null;
	investmentGoal: number | null;
	savingsGoalAchieved: boolean;
	expenseGoalAchieved: boolean;
};
