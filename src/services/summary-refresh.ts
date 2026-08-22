import type { Bindings } from "../env";
import { currentMonthInJst, monthRange, nowInJst, previousMonth } from "../lib/date";
import { describeError, log } from "../lib/log";
import type { ExpenseBreakdown } from "./expense-breakdown";
import { breakdownExpenses } from "./expense-breakdown";
import type { SummarySectionStatus } from "./notion";
import { createNotionService } from "./notion";
import { buildSectionHeading, renderSummaryBlocks } from "./summary-page";

export type SummaryRefreshResult = {
	pageId: string;
	title: string;
	/** YYYY-MM。日付未設定なら null。 */
	month: string | null;
	status: SummarySectionStatus;
	updatedAt: string;
};

type NotionService = ReturnType<typeof createNotionService>;

export function createNotionServiceFromEnv(env: Bindings): NotionService {
	return createNotionService({
		apiKey: env.NOTION_API_KEY,
		databaseId: env.NOTION_DATABASE_ID,
		dataSourceId: env.NOTION_DATASOURCE_ID,
		summaryDataSourceId: env.NOTION_SUMMARY_DATA_SOURCE_ID,
	});
}

/** サマリページ1枚を最新化する。内容が変わっていなければ書き込まない。 */
export async function refreshSummaryPage(notionService: NotionService, pageId: string): Promise<SummaryRefreshResult> {
	const values = await notionService.fetchSummaryValues(pageId);
	const month = values.date?.slice(0, 7) ?? null;
	const breakdown = month === null ? null : await loadBreakdown(notionService, month);
	const updatedAt = nowInJst();
	const { status } = await notionService.replaceSummarySection(
		pageId,
		renderSummaryBlocks(values, breakdown),
		buildSectionHeading(updatedAt),
	);

	return { pageId, title: values.title, month, status, updatedAt };
}

/**
 * カテゴリ別集計と明細のもとになる支出を読む。
 * 前月分も読むのはカテゴリごとの増減を出すため。
 * ここで失敗しても資産推移などは出せるので、握りつぶして null を返す。
 */
async function loadBreakdown(notionService: NotionService, month: string): Promise<ExpenseBreakdown | null> {
	try {
		const [current, previous] = await Promise.all([
			notionService.queryExpensesInMonth(month),
			notionService.queryExpensesInMonth(previousMonth(month)),
		]);
		return breakdownExpenses(current.items, previous.items, current.truncated);
	} catch (error) {
		log("warn", "expense_breakdown_unavailable", { month, ...describeError(error) });
		return null;
	}
}

/**
 * 定期実行で見る対象は「今月」と「前月」のサマリページ。
 * 月初は前月の資産額を後から記入することが多く、今月だけだと取りこぼすため。
 */
export async function refreshRecentSummaries(
	notionService: NotionService,
	now: Date = new Date(),
): Promise<SummaryRefreshResult[]> {
	const thisMonth = currentMonthInJst(now);
	const from = monthRange(previousMonth(thisMonth)).start;
	const toExclusive = monthRange(thisMonth).endExclusive;

	const pageIds = await notionService.querySummaryPageIds(from, toExclusive);
	const results: SummaryRefreshResult[] = [];

	for (const pageId of pageIds) {
		try {
			results.push(await refreshSummaryPage(notionService, pageId));
		} catch (error) {
			// 1枚失敗しても残りは処理する。
			log("error", "summary_refresh_failed", { pageId, ...describeError(error) });
		}
	}

	return results;
}
