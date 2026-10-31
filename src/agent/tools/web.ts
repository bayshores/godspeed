import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { splitPages } from "../../core/work-pages.ts";
import { serverExecute } from "../tool-execute.ts";
import type TurndownService from "turndown";

/**
 * Server-side web tools for the researcher sub-agent — a minimal port of the
 * pi web-fetch extension (~/.pi/agent/extensions/web-fetch):
 *
 *   web_fetch(url) → readable markdown text (Readability + Turndown, Jina
 *                    Reader fallback for JS-rendered pages)
 *
 * There is no search engine tool.
 *
 * Tool contract: NEVER throw into the agent loop — every failure path
 * returns a clear error STRING as the tool output, so the researcher can
 * adapt (or report) instead of crashing.
 */

// ── web_fetch ────────────────────────────────────────────────────────────────

export const USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/** A URL whose path ends in .pdf counts as a PDF whatever its content type:
 *  S3 and university servers often send PDFs as octet-stream. Shared by
 *  web_fetch and web_fetch_pdf so both judge the same URL the same way. */
export function isPdfUrl(url: string): boolean {
	try {
		return /\.pdf$/i.test(new URL(url).pathname);
	} catch {
		return false;
	}
}

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MIN_USEFUL_CONTENT = 200;

/** The page reader (Readability + linkedom + Turndown, ~1 MB of code),
 *  loaded on the first web_fetch, not at server start. */
let reader: Promise<{
	Readability: typeof import("@mozilla/readability").Readability;
	parseHTML: typeof import("linkedom").parseHTML;
	turndown: TurndownService;
}> | null = null;
function loadReader() {
	reader ??= Promise.all([import("@mozilla/readability"), import("linkedom"), import("turndown")]).then(([readability, linkedom, td]) => ({
		Readability: readability.Readability,
		parseHTML: linkedom.parseHTML,
		turndown: new td.default({ headingStyle: "atx", codeBlockStyle: "fenced" }),
	}));
	return reader;
}

/** At most one work page: the result comes back to the outside agent inside a work
 *  item, and every page past the first costs it a read_work call. */
function truncate(text: string): string {
	const pages = splitPages(text);
	if (pages.length === 1) return text;
	return `${pages[0]!}\n\n[Truncated: the page goes on]`;
}

/** Jina Reader fallback for JS-rendered pages (no deps — plain fetch). */
async function fetchViaJina(url: string, signal?: AbortSignal): Promise<string | null> {
	try {
		const res = await fetch(`https://r.jina.ai/${url}`, {
			headers: { Accept: "text/markdown", "X-No-Cache": "true" },
			signal,
		});
		if (!res.ok) return null;
		const content = await res.text();
		const marker = "Markdown Content:";
		const start = content.indexOf(marker);
		if (start < 0) return null;
		const markdown = content.slice(start + marker.length).trim();
		if (markdown.length < MIN_USEFUL_CONTENT || markdown.startsWith("Loading...")) return null;
		return markdown;
	} catch {
		return null;
	}
}

async function htmlToMarkdown(html: string): Promise<{ title: string; content: string } | null> {
	const { Readability, parseHTML, turndown } = await loadReader();
	const { document } = parseHTML(html);
	const article = new Readability(document as unknown as Document).parse();
	if (!article?.content) return null;
	const markdown = turndown.turndown(article.content);
	if (markdown.trim().length < MIN_USEFUL_CONTENT) return null;
	return { title: article.title ?? "", content: markdown };
}

/** `signal` is the tool guard's (its timeout or Stop): one deadline for the
 *  page and the Jina fallback together, and an abandoned fetch is cancelled. */
async function fetchAndExtract(url: string, signal?: AbortSignal): Promise<string> {
	const resp = await fetch(url, {
		headers: {
			"User-Agent": USER_AGENT,
			Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			"Accept-Language": "en-US,en;q=0.9",
		},
		signal,
	});
	if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);

	// Final URL after redirects + status: the researcher's only way to
	// tell a real page from a 200-served error body.
	const sourceLine = `Source: ${resp.url || url} (HTTP ${resp.status})`;

	const contentType = resp.headers.get("content-type") ?? "";
	if (contentType.includes("application/pdf") || isPdfUrl(url)) {
		// Pointer, not dead-end: web_fetch_pdf downloads + triages PDFs.
		return `web_fetch: this URL is a PDF document — call web_fetch_pdf on it to download and read it.`;
	}
	if (/image\/|audio\/|video\/|zip|octet-stream/.test(contentType)) {
		throw new Error(`Unsupported content type: ${contentType.split(";")[0]}`);
	}
	const length = Number(resp.headers.get("content-length") ?? 0);
	if (length > MAX_RESPONSE_BYTES) throw new Error("Response too large");

	const text = await resp.text();
	if (!contentType.includes("html")) return truncate(`${sourceLine}\n\n${text}`); // plain text / markdown / code

	const extracted = await htmlToMarkdown(text);
	if (extracted) {
		const header = extracted.title ? `# ${extracted.title}\n\n${sourceLine}\n\n---\n\n` : `${sourceLine}\n\n---\n\n`;
		return truncate(header + extracted.content);
	}
	// Readability failed — likely JS-rendered. Try Jina Reader.
	const jina = await fetchViaJina(url, signal);
	if (jina) return truncate(jina);
	signal?.throwIfAborted(); // say "aborted", not "could not extract"
	throw new Error("Could not extract readable content (the page may be JavaScript-rendered)");
}

// ── tool registry ────────────────────────────────────────────────────────────

const webFetchInput = Type.Object({
	url: Type.String({ description: "The URL to fetch" }),
});

export const webTools: Record<string, AgentTool<any>> = {
	web_fetch: {
		name: "web_fetch",
		label: "web_fetch",
		description:
			"Fetch a web page and extract its readable content as markdown (Readability). " +
			"Handles HTML pages and plain text; JS-rendered pages fall back to a reader service.",
		parameters: webFetchInput,
		execute: serverExecute("web_fetch", webFetchInput, async ({ url }, { signal }): Promise<string> => {
			try {
				const parsed = new URL(url);
				// URL.protocol carries a TRAILING COLON ("https:", WHATWG).
				if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
					throw new Error("Only http(s) URLs are supported");
			} catch {
				return `web_fetch failed: invalid URL "${url}"`;
			}
			try {
				return await fetchAndExtract(url, signal);
			} catch (err) {
				return `web_fetch failed for ${url}: ${err instanceof Error ? err.message : String(err)}`;
			}
		}),
	},
};
