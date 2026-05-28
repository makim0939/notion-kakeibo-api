const STATIC_CATEGORY_KEYWORDS: Record<string, string[]> = {
	"日用・食費": ["ご飯", "ごはん", "食材", "日用", "掃除"],
	住居費: ["家賃", "電気", "ガス", "水道", "通信"],
	生活費: ["服", "美容院"],
	遊び: ["映画", "スタバ", "外食"],
	仕事勉強費: ["通勤", "Udemy", "講座"],
	旅行: ["旅行"],
	特別費: ["病院"],
};

const DEFAULT_CATEGORY = "未分類";

type CategoryKeywordMap = Record<string, string[]>;

export type CategoryHistoryRecord = {
	name: string;
	category: string;
};

export function buildCategoryKeywordMap(
	historyRecords: CategoryHistoryRecord[] = [],
): CategoryKeywordMap {
	const map: CategoryKeywordMap = {};

	for (const [category, keywords] of Object.entries(STATIC_CATEGORY_KEYWORDS)) {
		map[category] = [...new Set(keywords)];
	}

	for (const record of historyRecords) {
		if (!map[record.category]) {
			map[record.category] = [];
		}
		map[record.category].push(record.name);
	}

	for (const category of Object.keys(map)) {
		map[category] = Array.from(new Set(map[category]));
	}

	return map;
}

export function decideCategory(
	text: string,
	keywordMap: CategoryKeywordMap,
): string {
	return classifyText(text, keywordMap);
}

function classifyText(text: string, keywordMap: CategoryKeywordMap): string {
	const normalizedText = text.toString();
	let matchedCategory = DEFAULT_CATEGORY;
	let maxHits = 0;

	for (const [category, keywords] of Object.entries(keywordMap)) {
		let hits = 0;
		for (const keyword of keywords) {
			if (keyword && normalizedText.includes(keyword)) {
				hits++;
			}
		}

		if (hits > maxHits) {
			maxHits = hits;
			matchedCategory = category;
		}
	}

	return matchedCategory;
}
