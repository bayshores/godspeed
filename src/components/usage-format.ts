/**
 * Usage/token presentation helpers, shared by the activity dock and the
 * stats bar. Pure; exported for tests.
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

/** Split a provider-qualified stamp "provider:id" into its two
 *  coordinates. No colon = a bare id. */
function splitQualified(id: string): { provider: string | null; id: string } {
	const colon = id.indexOf(":");
	if (colon === -1) return { provider: null, id };
	return { provider: id.slice(0, colon), id: id.slice(colon + 1) };
}

/**
 * "z-ai/glm-5.3-flash" → "glm-5.3-flash": vendor prefix dropped, the
 * name kept exactly as its provider writes it; a trailing all-digit
 * date segment ("qwen3.8-max-0902") is dropped.
 *
 * A "provider:id" stamp keeps its provider as a quiet suffix
 * ("glm-5.3-flash · provider"): the same model via two providers is
 * different bookkeeping.
 */
export function prettyModel(id: string): string {
	const { provider, id: bare } = splitQualified(id);
	const short = bare.includes("/") ? bare.slice(bare.lastIndexOf("/") + 1) : bare;
	const parts = short.split("-");
	const trimmed = /^\d+$/.test(parts[parts.length - 1] ?? "") ? parts.slice(0, -1) : parts;
	const pretty = trimmed.join("-");
	return provider ? `${pretty} · ${provider}` : pretty;
}