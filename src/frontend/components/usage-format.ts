/**
 * Usage/token presentation helpers, shared by the activity dock and the
 * lesson stats. Pure; exported for tests.
 */

/** The plan labels, or "–" when none (never a fake zero). */
export function planCostLabel(subscription: string | readonly string[] | undefined): string {
	const labels = typeof subscription === "string" ? [subscription] : Array.isArray(subscription) ? [...new Set(subscription)] : [];
	return labels.join(" + ") || "–";
}

/** 38000 → "38k", 1234567 → "1.2M" — trimmed, never "38.0k". */
export function formatTokens(n: number): string {
	if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
	if (n >= 1e3) return `${+(n / 1e3).toFixed(1)}k`;
	return String(n);
}

/** About how many tokens one printed page of lesson text holds (roughly 375 words),
 *  so learner-facing lengths read in pages instead of tokens. */
const TOKENS_PER_PAGE = 500;

const pageCount = (tokens: number): number => Math.max(1, Math.round(tokens / TOKENS_PER_PAGE));

/** 40000 → "about 80 pages", 400 → "about 1 page". */
export function pagesLabel(tokens: number): string {
	const pages = pageCount(tokens);
	return `about ${pages} page${pages === 1 ? "" : "s"}`;
}

/** The lesson's size against where it gets summarized: "about 79 of 80 pages",
 *  "about 79 pages" while that point is unknown, null while the size is. */
export function lessonSizeLabel(tokens: number | null, summarizeAt: number | null): string | null {
	if (tokens === null) return null;
	if (summarizeAt === null || summarizeAt <= 0) return pagesLabel(tokens);
	return `about ${pageCount(tokens)} of ${pageCount(summarizeAt)} pages`;
}
