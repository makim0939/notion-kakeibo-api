import type { BlockObjectRequest } from "@notionhq/client";
import type { SummaryValues } from "../types/summary";

/**
 * 自動生成セクションの目印。
 * この見出しで始まるコールアウトを1つ作り、その子ブロックとして本文を生成する。
 * 子ブロックごと差し替えれば何度更新しても重複しないので、
 * 「プレースホルダを置換すると次回は置換対象が無い」という問題が起きない。
 */
export const MANAGED_SECTION_PREFIX = "月次サマリ（自動生成）";

/** コールアウト見出しの文言。最終更新時刻を添える。 */
export function buildSectionHeading(updatedAt: string): string {
	return `${MANAGED_SECTION_PREFIX} / 最終更新 ${updatedAt}`;
}

/**
 * サマリ本文のブロックを組み立てる。
 * Notion に触らない純粋な関数なので、そのままテストできる。
 */
export function renderSummaryBlocks(values: SummaryValues): BlockObjectRequest[] {
	return [
		heading("目標達成状況"),
		...goalBlocks(values),
		heading("資産推移"),
		paragraph(transition(values.previousTotalAssets, currentTotalAssets(values))),
		heading3("貯金口座"),
		paragraph(transition(values.previousSavings, values.savings)),
		heading3("積立投信"),
		paragraph(transition(values.previousInvestment, values.investment)),
		heading("収支"),
		paragraph(`総収入 ${yen(values.income)} ／ 総支出 ${yen(values.expense)}`),
		paragraph(`収支の差額 ${signedYen(difference(values.income, values.expense))}`),
		...(values.discretionaryExpense === null
			? []
			: [paragraph(`うち住居・食費以外の支出 ${yen(values.discretionaryExpense)}`)]),
	];
}

/**
 * 「💰総資産」は貯金＋投資の数式なので、両方未入力でも 0 が入る。
 * 「未入力 → 0 円」と出るのは紛らわしいため、内訳が両方空なら未入力として扱う。
 */
function currentTotalAssets(values: SummaryValues): number | null {
	if (values.savings === null && values.investment === null) {
		return null;
	}
	return values.totalAssets;
}

function goalBlocks(values: SummaryValues): BlockObjectRequest[] {
	const blocks: BlockObjectRequest[] = [];

	if (values.expenseGoal !== null) {
		blocks.push(todo(`生活費を除き出費を${groupDigits(values.expenseGoal)}円で抑える`, values.expenseGoalAchieved));
	}
	if (values.savingsGoal !== null) {
		blocks.push(todo(`${groupDigits(values.savingsGoal)}円貯金する`, values.savingsGoalAchieved));
	}
	if (values.investmentGoal !== null) {
		// 投資には達成判定の数式が無いので、前月差から自分で判定する。
		const increase = difference(values.investment, values.previousInvestment);
		blocks.push(
			todo(
				`${groupDigits(values.investmentGoal)}円投資信託に積み立てる`,
				increase !== null && increase >= values.investmentGoal,
			),
		);
	}

	if (blocks.length === 0) {
		blocks.push(paragraph("目標が未設定です。"));
	}

	return blocks;
}

/** 「前月 → 今月（増減）」の1行。 */
function transition(previous: number | null, current: number | null): string {
	const diff = difference(current, previous);
	const base = `${yen(previous)} → ${yen(current)}`;
	return diff === null ? base : `${base}（${signedYen(diff)}）`;
}

function difference(a: number | null, b: number | null): number | null {
	if (a === null || b === null) {
		return null;
	}
	return a - b;
}

/** 金額表記。未入力は「未入力」と出して、0円と区別できるようにする。 */
function yen(value: number | null): string {
	return value === null ? "未入力" : `${groupDigits(value)} 円`;
}

function signedYen(value: number | null): string {
	if (value === null) {
		return "未入力";
	}
	const sign = value >= 0 ? "+" : "-";
	return `${sign}${groupDigits(Math.abs(value))} 円`;
}

function groupDigits(value: number): string {
	const negative = value < 0;
	const digits = Math.abs(Math.round(value)).toString();
	const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
	return negative ? `-${grouped}` : grouped;
}

function heading(text: string): BlockObjectRequest {
	return { heading_2: { rich_text: [{ text: { content: text } }] } };
}

function heading3(text: string): BlockObjectRequest {
	return { heading_3: { rich_text: [{ text: { content: text } }] } };
}

function paragraph(text: string): BlockObjectRequest {
	return { paragraph: { rich_text: [{ text: { content: text } }] } };
}

function todo(text: string, checked: boolean): BlockObjectRequest {
	return { to_do: { rich_text: [{ text: { content: text } }], checked } };
}

/** コールアウト本体。子ブロックは別途 append する。 */
export function buildSectionCallout(heading: string): BlockObjectRequest {
	return {
		callout: {
			rich_text: [{ text: { content: heading } }],
			icon: { emoji: "🔄" },
			color: "gray_background",
		},
	};
}
