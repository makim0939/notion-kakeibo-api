const CATEGORY_KEYWORDS: Record<string, string[]> = {
	食費: ["昼ごはん", "ファミマ", "ローソン", "セブン"],
	日用品: ["Amazon", "マツキヨ", "ウエルシア"],
	旅行: ["旅行", "ホテル", "新幹線"],
};

export function decideCategory(text: string): string {
	let matchedCategory = "未分類";
	let maxHits = 0;

	for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
		let hits = 0;

		for (const keyword of keywords) {
			if (text.includes(keyword)) {
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
