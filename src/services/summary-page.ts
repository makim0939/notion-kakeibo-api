import type { BlockObjectRequest } from "@notionhq/client";
import type { SummaryValues } from "../types/summary";
import type { ExpenseBreakdown } from "./expense-breakdown";

/**
 * 自動生成セクションの開始位置。この見出しから下、フッタまでが毎回作り直される。
 * 見出し自体は月によらず固定文言にして、目印として探せるようにしている。
 */
export const MANAGED_HEADING = "📊 月次サマリ";

/**
 * 自動生成セクションの終端。最終更新時刻を添える。
 * 開始と終端で挟むことで、ユーザが下に書き足した内容を巻き込まずに差し替えられる。
 */
export const MANAGED_FOOTER_PREFIX = "最終更新 ";

export function buildFooterText(updatedAt: string): string {
	return `${MANAGED_FOOTER_PREFIX}${updatedAt}`;
}

/**
 * サマリ本文のブロックを組み立てる。
 * Notion に触らない純粋な関数なので、そのままテストできる。
 *
 * 見出しと短い表だけで構成し、1画面で読み切れる分量に収めている。
 */
export function renderSummaryBlocks(
	values: SummaryValues,
	breakdown: ExpenseBreakdown | null = null,
	updatedAt = "",
): BlockObjectRequest[] {
	return [
		heading1(MANAGED_HEADING),
		...goalBlocks(values),
		...balanceBlocks(values),
		...assetBlocks(values),
		...categoryBlocks(breakdown),
		divider(),
		paragraph(buildFooterText(updatedAt)),
	];
}

/** 今月の目標と、その達成状況。 */
function goalBlocks(values: SummaryValues): BlockObjectRequest[] {
	const todos: BlockObjectRequest[] = [];

	if (values.expenseGoal !== null) {
		todos.push(todo(`生活費を除き出費を${groupDigits(values.expenseGoal)}円で抑える`, values.expenseGoalAchieved));
	}
	if (values.savingsGoal !== null) {
		todos.push(todo(`${groupDigits(values.savingsGoal)}円貯金する`, values.savingsGoalAchieved));
	}
	if (values.investmentGoal !== null) {
		// 投資には達成判定の数式が無いので、前月差から自分で判定する。
		const increase = difference(values.investment, values.previousInvestment);
		todos.push(
			todo(
				`${groupDigits(values.investmentGoal)}円投資信託に積み立てる`,
				increase !== null && increase >= values.investmentGoal,
			),
		);
	}

	return [heading("目標"), ...(todos.length === 0 ? [paragraph("目標が未設定です。")] : todos)];
}

/** 収入と支出。差額まで1つの表で見えるようにする。 */
function balanceBlocks(values: SummaryValues): BlockObjectRequest[] {
	const rows = [
		tableRow(["総収入", yen(values.income)]),
		tableRow(["総支出", yen(values.expense)]),
		tableRow(["差額", signedYen(difference(values.income, values.expense))]),
	];

	if (values.discretionaryExpense !== null) {
		rows.push(tableRow(["うち住居・食費以外", yen(values.discretionaryExpense)]));
	}

	return [heading("収支"), table(["項目", "金額"], rows)];
}

/** 資産の増減。前月と並べて置くことで、増えたのか減ったのかを一目で分かるようにする。 */
function assetBlocks(values: SummaryValues): BlockObjectRequest[] {
	return [
		heading("資産"),
		table(
			["項目", "前月", "今月", "増減"],
			[
				assetRow("貯金口座", values.previousSavings, values.savings),
				assetRow("積立投信", values.previousInvestment, values.investment),
				assetRow("合計", values.previousTotalAssets, currentTotalAssets(values)),
			],
		),
	];
}

function assetRow(label: string, previous: number | null, current: number | null): BlockObjectRequest {
	return tableRow([label, yen(previous), yen(current), signedYen(difference(current, previous))]);
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

function heading1(text: string): BlockObjectRequest {
	return { heading_1: { rich_text: [{ text: { content: text } }] } };
}

function divider(): BlockObjectRequest {
	return { divider: {} };
}

function heading(text: string): BlockObjectRequest {
	return { heading_2: { rich_text: [{ text: { content: text } }] } };
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
