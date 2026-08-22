import { normalizeText, tokenize } from "../lib/text";
import type { CategoryHistoryRecord, ExpenseCategory } from "../types/expense";
import { UNCATEGORIZED } from "../types/expense";

/**
 * 静的キーワード。過去履歴が少ないうちの初期値であり、
 * 履歴から学習したキーワードよりも優先度を高く扱う。
 */
const STATIC_CATEGORY_KEYWORDS: Record<ExpenseCategory, string[]> = {
	"日用・食費": ["ご飯", "ごはん", "食材", "日用", "掃除"],
	居住費: ["家賃", "電気", "ガス", "水道", "通信"],
	生活費: ["服", "美容院"],
	遊び費: ["映画", "スタバ", "外食"],
	仕事勉強費: ["通勤", "Udemy", "講座"],
	旅行費: ["旅行"],
	特別費: ["病院"],
	投資: ["投資信託", "積立"],
};

/**
 * 履歴から学習するキーワードの最小長。
 * 1文字だと無関係な支出名にも当たってしまうため足切りする。
 */
const MIN_LEARNED_KEYWORD_LENGTH = 2;

type KeywordEntry = {
	/** 正規化済みキーワード。 */
	keyword: string;
	category: string;
	/** 静的キーワードなら true。 */
	curated: boolean;
	/** 同点時の決定性を保つための登録順。 */
	order: number;
};

export type CategoryIndex = {
	/** 正規化した支出名 -> 最も多く使われたカテゴリ。 */
	exactMatches: Map<string, string>;
	keywords: KeywordEntry[];
};

type CategoryScore = {
	category: string;
	longestKeyword: number;
	hits: number;
	curated: boolean;
	order: number;
};

/**
 * 静的キーワードと過去履歴からカテゴリ判定用のインデックスを組み立てる。
 * 履歴の支出名は丸ごとに加えて語単位でも登録するので、
 * 「スタバ ラテ」の履歴から「スタバ」だけでも当たるようになる。
 */
export function buildCategoryIndex(historyRecords: CategoryHistoryRecord[] = []): CategoryIndex {
	const keywords: KeywordEntry[] = [];
	const seen = new Set<string>();

	const addKeyword = (raw: string, category: string, curated: boolean) => {
		const keyword = normalizeText(raw);
		if (!keyword) {
			return;
		}
		if (!curated && keyword.length < MIN_LEARNED_KEYWORD_LENGTH) {
			return;
		}

		const dedupeKey = `${category}::${keyword}`;
		if (seen.has(dedupeKey)) {
			return;
		}

		seen.add(dedupeKey);
		keywords.push({ keyword, category, curated, order: keywords.length });
	};

	for (const [category, categoryKeywords] of Object.entries(STATIC_CATEGORY_KEYWORDS)) {
		for (const keyword of categoryKeywords) {
			addKeyword(keyword, category, true);
		}
	}

	// 支出名 -> カテゴリ -> 出現回数。同じ名前が別カテゴリで登録されている場合に多数決する。
	const nameCounts = new Map<string, Map<string, number>>();

	for (const record of historyRecords) {
		const name = record.名前;
		const category = record.カテゴリ;
		if (!name || !category || category === UNCATEGORIZED) {
			continue;
		}

		const normalizedName = normalizeText(name);
		if (!normalizedName) {
			continue;
		}

		const counts = nameCounts.get(normalizedName) ?? new Map<string, number>();
		counts.set(category, (counts.get(category) ?? 0) + 1);
		nameCounts.set(normalizedName, counts);

		addKeyword(name, category, false);
		for (const token of tokenize(name)) {
			addKeyword(token, category, false);
		}
	}

	const exactMatches = new Map<string, string>();
	for (const [name, counts] of nameCounts) {
		let bestCategory = "";
		let bestCount = 0;
		for (const [category, count] of counts) {
			if (count > bestCount) {
				bestCount = count;
				bestCategory = category;
			}
		}
		if (bestCategory) {
			exactMatches.set(name, bestCategory);
		}
	}

	return { exactMatches, keywords };
}

/**
 * 支出名からカテゴリを決定する。
 *
 * 1. 過去に同じ支出名で登録していれば、そのカテゴリを採用する。
 * 2. 部分一致したキーワードのうち最も長い（＝具体的な）ものを採用する。
 *    長さが同じ場合は一致数、静的キーワード優先、登録順の順で決める。
 * 3. どれにも当たらなければ「未分類」。
 */
export function decideCategory(text: string, index: CategoryIndex): string {
	const normalized = normalizeText(text);
	if (!normalized) {
		return UNCATEGORIZED;
	}

	const exact = index.exactMatches.get(normalized);
	if (exact) {
		return exact;
	}

	const scores = new Map<string, CategoryScore>();

	for (const entry of index.keywords) {
		if (!normalized.includes(entry.keyword)) {
			continue;
		}

		const current = scores.get(entry.category);
		if (!current) {
			scores.set(entry.category, {
				category: entry.category,
				longestKeyword: entry.keyword.length,
				hits: 1,
				curated: entry.curated,
				order: entry.order,
			});
			continue;
		}

		current.hits += 1;
		if (entry.keyword.length > current.longestKeyword) {
			current.longestKeyword = entry.keyword.length;
			current.curated = entry.curated;
			current.order = entry.order;
		} else if (entry.keyword.length === current.longestKeyword) {
			current.curated = current.curated || entry.curated;
		}
	}

	let best: CategoryScore | undefined;
	for (const score of scores.values()) {
		if (!best || isBetterScore(score, best)) {
			best = score;
		}
	}

	return best?.category ?? UNCATEGORIZED;
}

function isBetterScore(candidate: CategoryScore, current: CategoryScore): boolean {
	if (candidate.longestKeyword !== current.longestKeyword) {
		return candidate.longestKeyword > current.longestKeyword;
	}
	if (candidate.hits !== current.hits) {
		return candidate.hits > current.hits;
	}
	if (candidate.curated !== current.curated) {
		return candidate.curated;
	}
	return candidate.order < current.order;
}
