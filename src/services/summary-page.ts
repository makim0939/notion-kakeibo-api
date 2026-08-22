import type { BlockObjectRequest } from "@notionhq/client";
import type { SummaryValues } from "../types/summary";
import type { ExpenseBreakdown } from "./expense-breakdown";

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
export function renderSummaryBlocks(
	values: SummaryValues,
	breakdown: ExpenseBreakdown | null = null,
): BlockObjectRequest[] {
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
		...categoryBlocks(breakdown),
	];
}

/** カテゴリ別の支出額。何にいくら使ったかを一覧で見るための表。 */
function categoryBlocks(breakdown: ExpenseBreakdown | null): BlockObjectRequest[] {
	if (!breakdown) {
		return [];
	}
	if (breakdown.rows.length === 0) {
		return [heading("カテゴリ別の支出"), paragraph("この月の支出はまだありません。")];
	}

	// 一目で「何にいくら」だけ分かればよいので、列は2つに絞る。
	// 構成比は円グラフのビューに任せ、表には出さない。
	const rows = breakdown.rows.map((row) => tableRow([row.category, `${groupDigits(row.total)} 円`]));

	return [
		heading("カテゴリ別の支出"),
		table(["カテゴリ", "金額"], [...rows, tableRow(["合計", `${groupDigits(breakdown.total)} 円`])]),
		...(breakdown.investment === null
			? []
			: [paragraph(`※ 積立投資 ${groupDigits(breakdown.investment)} 円 は資産の移動なので支出に含めていません。`)]),
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

function tableRow(cells: string[]): BlockObjectRequest {
	return { table_row: { cells: cells.map((cell) => [{ text: { content: cell } }]) } };
}

function table(header: string[], rows: BlockObjectRequest[]): BlockObjectRequest {
	return {
		table: {
			table_width: header.length,
			has_column_header: true,
			children: [tableRow(header), ...rows],
		},
	} as BlockObjectRequest;
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

/** Notion から読んだ既存ブロック。表の行を比較するため子も持つ。 */
export type ExistingBlock = {
	id: string;
	type: string;
	children?: ExistingBlock[];
	[key: string]: unknown;
};

/**
 * ブロック列を比較用の文字列に潰す。
 * 見出しの最終更新時刻は毎回変わるので比較対象に含めず、本文だけを比べる。
 * これで「中身が変わっていないのに書き換える」のを防ぐ。
 * 表は行が子ブロックになるため、子までたどって比較する。
 */
export function summarySignature(blocks: BlockObjectRequest[]): string {
	return blocks.map((block) => signatureOfRequest(block)).join("\n");
}

function signatureOfRequest(block: BlockObjectRequest, depth = 0): string {
	const type = Object.keys(block)[0] as keyof typeof block;
	const body = block[type] as {
		rich_text?: { text: { content: string } }[];
		cells?: { text: { content: string } }[][];
		checked?: boolean;
		children?: BlockObjectRequest[];
	};

	const text =
		body.rich_text?.map((part) => part.text.content).join("") ??
		body.cells?.map((cell) => cell.map((part) => part.text.content).join("")).join("\t") ??
		"";

	const self = `${"  ".repeat(depth)}${type}\t${body.checked ?? ""}\t${text}`;
	const children = body.children?.map((child) => signatureOfRequest(child, depth + 1)) ?? [];

	return [self, ...children].join("\n");
}

/** Notion から読んだ既存ブロックを、summarySignature と同じ形式に潰す。 */
export function signatureOfExisting(blocks: ExistingBlock[], depth = 0): string {
	return blocks
		.map((block) => {
			const body = block[block.type] as
				| {
						rich_text?: { plain_text: string }[];
						cells?: { plain_text: string }[][];
						checked?: boolean;
				  }
				| undefined;

			const text =
				body?.rich_text?.map((part) => part.plain_text).join("") ??
				body?.cells?.map((cell) => cell.map((part) => part.plain_text).join("")).join("\t") ??
				"";

			const self = `${"  ".repeat(depth)}${block.type}\t${body?.checked ?? ""}\t${text}`;
			const children = block.children ? signatureOfExisting(block.children, depth + 1) : "";

			return children ? `${self}\n${children}` : self;
		})
		.join("\n");
}
