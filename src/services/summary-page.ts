import type { BlockObjectRequest } from "@notionhq/client";
import type { SummaryValues } from "../types/summary";
import type { ExpenseBreakdown } from "./expense-breakdown";

/**
 * 自動生成セクションの開始位置。ページ先頭のこの行から下が毎回作り直される。
 * 最終更新をここに置いているのは、ページを開いてすぐ鮮度が分かるようにするため。
 */
export const MANAGED_MARKER_PREFIX = "🔄 最終更新 ";

export function buildMarkerText(updatedAt: string): string {
	return `${MANAGED_MARKER_PREFIX}${updatedAt}`;
}

/** 見出しの文字色。ページのテンプレートに合わせている。 */
const HEADING_COLOR = "blue";

/** Notion「支出」DB のカテゴリに設定されているセレクトの色。バーの色をこれに揃える。 */
const CATEGORY_COLOR: Record<string, NotionColor> = {
	"日用・食費": "orange",
	居住費: "blue",
	生活費: "green",
	遊び費: "yellow",
	仕事勉強費: "purple",
	旅行費: "red",
	特別費: "pink",
	投資: "brown",
	未分類: "gray",
};

/** カテゴリ色が未登録の場合の色。 */
const FALLBACK_COLOR: NotionColor = "gray";

/** 比率バーの長さ（マス数）。モバイルで折り返さない範囲で最大にしている。 */
const BAR_CELLS = 14;

/** 1マスを8等分する部分ブロック。細い順。1マス未満の差も表現できる。 */
const PARTIAL_BLOCKS = ["▏", "▎", "▍", "▌", "▋", "▊", "▉"];

type NotionColor = "default" | "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red";

/** 文字色や等幅指定つきの文字列。 */
type Span = { text: string; color?: NotionColor; code?: boolean };

/**
 * サマリ本文のブロックを組み立てる。
 * Notion に触らない純粋な関数なので、そのままテストできる。
 *
 * 並び・段組み・色はページのテンプレートに合わせている。
 * 色の使い方は「前月＝グレー、増えた＝緑、減った＝赤、補足＝グレー」で統一する。
 */
export function renderSummaryBlocks(
	values: SummaryValues,
	breakdown: ExpenseBreakdown | null = null,
	updatedAt = "",
): BlockObjectRequest[] {
	return [
		paragraph([{ text: buildMarkerText(updatedAt), color: "gray" }]),
		goalCallout(values),
		...assetBlocks(values),
		divider(),
		...balanceBlocks(values),
		...categoryBlocks(breakdown),
	];
}

/** 今月の目標と、その達成状況。 */
function goalCallout(values: SummaryValues): BlockObjectRequest {
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

	return {
		callout: {
			rich_text: richText([{ text: "目標達成状況", color: HEADING_COLOR }]),
			icon: { emoji: "⛳" },
			children: todos.length === 0 ? [paragraph([{ text: "目標が未設定です。" }])] : todos,
		},
	} as BlockObjectRequest;
}

/** 資産推移。合計を上に出し、内訳の貯金と投資を左右に並べる。 */
function assetBlocks(values: SummaryValues): BlockObjectRequest[] {
	return [
		heading("資産推移"),
		paragraph(transition(values.previousTotalAssets, currentTotalAssets(values))),
		columns([
			[heading3("貯金口座"), paragraph(transition(values.previousSavings, values.savings))],
			[heading3("積立投信"), paragraph(transition(values.previousInvestment, values.investment))],
		]),
	];
}

/** 収支。ラベルの「：」を縦に揃えたいので、短い「収支」だけ空白で幅を合わせる。 */
function balanceBlocks(values: SummaryValues): BlockObjectRequest[] {
	const expense: Span[] = [{ text: `総支出：${yen(values.expense)}` }];

	if (values.discretionaryExpense !== null) {
		expense.push({ text: "\n" }, { text: `うち住居・食費以外：${yen(values.discretionaryExpense)}`, color: "gray" });
	}

	return [
		heading("収支"),
		paragraph([{ text: `総収入：${yen(values.income)}` }]),
		paragraph(expense),
		paragraph([{ text: "収支    ：" }, ...signed(difference(values.income, values.expense))]),
		divider(),
	];
}

/** カテゴリ別の支出額。金額に加えて、最大カテゴリを基準にしたバーで比率を出す。 */
function categoryBlocks(breakdown: ExpenseBreakdown | null): BlockObjectRequest[] {
	if (!breakdown) {
		return [];
	}
	if (breakdown.rows.length === 0) {
		return [heading("カテゴリ別の支出"), paragraph([{ text: "この月の支出はまだありません。" }])];
	}

	const max = Math.max(...breakdown.rows.map((row) => row.total));

	return [
		heading("カテゴリ別の支出"),
		table(
			["カテゴリ", "金額", "比率"],
			breakdown.rows.map((row) =>
				tableRow([
					[{ text: row.category }],
					[{ text: `${groupDigits(row.total)} 円` }],
					[...bar(row.total, max, CATEGORY_COLOR[row.category] ?? FALLBACK_COLOR), { text: ` ${row.ratio}%` }],
				]),
			),
		),
		...(breakdown.investment === null
			? []
			: [
					paragraph([
						{
							text: `※ 積立投資 ${groupDigits(breakdown.investment)} 円 は資産の移動なので支出に含めていません。`,
							color: "gray",
						},
					]),
				]),
	];
}

/**
 * 比率バー。最大のカテゴリが満杯になるよう正規化する。
 *
 * 全体に対する比率で引くと下位カテゴリが1マスに潰れて差が見えないため、
 * 最大値を基準にして解像度を稼いでいる。実際の割合は隣に % で出す。
 * 端数は部分ブロックで表すので、1マスあたり8段階の細かさで描ける。
 *
 * 塗りも余白も同じ幅の文字だけで組み、等幅指定を添える。
 * Notion の本文フォントはこれらの文字を持たず、環境ごとに別のフォントへ
 * 落ちるため、指定しないと文字ごとに幅が変わって右端がガタつく。
 */
function bar(value: number, max: number, color: NotionColor): Span[] {
	const eighths = max === 0 ? 0 : Math.max(1, Math.round((value / max) * BAR_CELLS * 8));
	const full = Math.floor(eighths / 8);
	const remainder = eighths % 8;

	const filled = "█".repeat(full) + (remainder ? PARTIAL_BLOCKS[remainder - 1] : "");
	const empty = "░".repeat(BAR_CELLS - full - (remainder ? 1 : 0));

	const spans: Span[] = [];
	if (filled) {
		spans.push({ text: filled, color, code: true });
	}
	if (empty) {
		spans.push({ text: empty, color: "gray", code: true });
	}
	return spans;
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

/** 「前月 → 今月 (増減)」の1行。前月をグレーに落として、今月の数字を目立たせる。 */
function transition(previous: number | null, current: number | null): Span[] {
	const diff = difference(current, previous);
	const spans: Span[] = [{ text: `${yen(previous)} → `, color: "gray" }, { text: yen(current) }];

	if (diff !== null) {
		spans.push({ text: " (" }, ...signed(diff), { text: ")" });
	}

	return spans;
}

/** 増減の表記。増えていれば緑、減っていれば赤。 */
function signed(value: number | null): Span[] {
	if (value === null) {
		return [{ text: "未入力" }];
	}
	return [{ text: signedYen(value), color: value >= 0 ? "green" : "red" }];
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

function richText(spans: Span[]) {
	return spans.map((span) => {
		const annotations = {
			...(span.color ? { color: span.color } : {}),
			...(span.code ? { code: true } : {}),
		};
		return {
			text: { content: span.text },
			...(Object.keys(annotations).length > 0 ? { annotations } : {}),
		};
	});
}

function heading(text: string): BlockObjectRequest {
	return { heading_2: { rich_text: richText([{ text, color: HEADING_COLOR }]) } };
}

function heading3(text: string): BlockObjectRequest {
	return { heading_3: { rich_text: richText([{ text, color: HEADING_COLOR }]) } };
}

function paragraph(spans: Span[]): BlockObjectRequest {
	return { paragraph: { rich_text: richText(spans) } };
}

function todo(text: string, checked: boolean): BlockObjectRequest {
	return { to_do: { rich_text: [{ text: { content: text } }], checked } };
}

function divider(): BlockObjectRequest {
	return { divider: {} };
}

/** 左右に並べる段組み。 */
function columns(children: BlockObjectRequest[][]): BlockObjectRequest {
	return {
		column_list: {
			children: children.map((blocks) => ({ column: { children: blocks } })),
		},
	} as BlockObjectRequest;
}

export function tableRow(cells: Span[][]): BlockObjectRequest {
	return { table_row: { cells: cells.map((cell) => richText(cell)) } };
}

function table(header: string[], rows: BlockObjectRequest[]): BlockObjectRequest {
	return {
		table: {
			table_width: header.length,
			has_column_header: true,
			children: [tableRow(header.map((text) => [{ text }])), ...rows],
		},
	} as BlockObjectRequest;
}

/**
 * Notion 上のテキストを比較用にならす。
 * 絵文字の直後などに Notion がノーブレークスペースを入れることがあり、
 * 見た目が同じでも普通の空白と一致しなくなるため、ここで吸収する。
 */
export function normalizeNotionText(text: string): string {
	return text.replaceAll("\u00a0", " ");
}

/** Notion から読んだ既存ブロック。表の行や段組みの中身を比較するため子も持つ。 */
export type ExistingBlock = {
	id: string;
	type: string;
	children?: ExistingBlock[];
	[key: string]: unknown;
};

/**
 * ブロック列を比較用の文字列に潰す。
 * これで「中身が変わっていないのに書き換える」のを防ぐ。
 * 表の行や段組みの中身は子ブロックになるため、子までたどって比較する。
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

			const text = normalizeNotionText(
				body?.rich_text?.map((part) => part.plain_text).join("") ??
					body?.cells?.map((cell) => cell.map((part) => part.plain_text).join("")).join("\t") ??
					"",
			);

			const self = `${"  ".repeat(depth)}${block.type}\t${body?.checked ?? ""}\t${text}`;
			const children = block.children ? signatureOfExisting(block.children, depth + 1) : "";

			return children ? `${self}\n${children}` : self;
		})
		.join("\n");
}
