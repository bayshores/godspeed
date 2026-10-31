/**
 * Researcher PDF capability (PDF wave, 2026-10-07, design B): web_fetch_pdf
 * downloads a PDF into a per-job temp dir and returns the triage summary;
 * pdf_info/pdf_extract/pdf_search read it page-level, ALL scoped to the dir
 * (the researcher's filesystem ends at the temp wall). web_fetch gained the
 * PDF POINTER (no dead-end) and the Source line with final URL + HTTP
 * status (the "ill-formed request" lesson: 200-served error bodies must be
 * distinguishable from real pages).
 *
 * Zero network: globalThis.fetch is stubbed with a REAL minimal PDF built
 * programmatically (correct xref offsets — pdfjs parses it like any
 * download). Rendering is out of scope here (no vision in the researcher).
 */

import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { createPdfReadTools } from "../src/agent/tools/pdf-read.ts";
import { webTools } from "../src/agent/tools/web.ts";
import { WORK_PAGE_BYTES } from "../src/core/work-pages.ts";

/** Build a valid N-page PDF in memory — ASCII-only so string offsets ARE
 *  byte offsets; xref entries computed as we assemble. */
function buildPdf(pageTexts: string[]): Uint8Array {
	const objects: string[] = []; // 1-indexed
	const pageIds = pageTexts.map((_, i) => 3 + i * 2);
	const fontId = 3 + pageTexts.length * 2;
	objects[1] = "<</Type/Catalog/Pages 2 0 R>>";
	objects[2] = `<</Type/Pages/Kids[${pageIds.map((id) => `${id} 0 R`).join(" ")}]/Count ${pageTexts.length}>>`;
	pageTexts.forEach((text, i) => {
		const pageId = pageIds[i]!;
		const contentId = pageId + 1;
		const escaped = text.replace(/([()\\])/g, "\\$1");
		const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
		objects[pageId] =
			`<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents ${contentId} 0 R` +
			`/Resources<</Font<</F1 ${fontId} 0 R>>>>>>`;
		objects[contentId] = `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`;
	});
	objects[fontId] = "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>";

	let pdf = "%PDF-1.4\n";
	const offsets: number[] = [];
	for (let id = 1; id < objects.length; id++) {
		offsets[id] = pdf.length;
		pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
	}
	const xrefStart = pdf.length;
	pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
	for (let id = 1; id < objects.length; id++) {
		pdf += `${String(offsets[id]!).padStart(10, "0")} 00000 n \n`;
	}
	pdf += `trailer\n<</Size ${objects.length}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF\n`;
	return new TextEncoder().encode(pdf);
}

/** A fresh Response per call (bodies are single-use). */
const pdfResponse = () =>
	new Response(PDF_BYTES.slice().buffer as ArrayBuffer, { headers: { "content-type": "application/pdf" } });

const PDF_BYTES = buildPdf([
	"Hello PDF page one — the triage summary should see this.",
	"Page two holds the orthogonal complement theorem statement.",
]);

const tempDirs: string[] = [];
async function newDir(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lh-test-pdf-"));
	tempDirs.push(dir);
	return dir;
}
after(async () => {
	await Promise.all(tempDirs.map((d) => fs.rm(d, { recursive: true, force: true })));
});

/** Tool-result .details → displayable string (the agent sees this shape). */
function asText(result: unknown): string {
	const r = result as { details?: unknown };
	if (typeof r?.details === "string") return r.details;
	return JSON.stringify(r?.details ?? r);
}

describe("researcher pdf tools — download + triage", () => {
	it("web_fetch_pdf downloads, triages, and returns a usable summary", async () => {
		const dir = await newDir();
		const tools = createPdfReadTools(dir);
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			pdfResponse()) as typeof fetch;
		try {
			const out = await tools.web_fetch_pdf!.execute!("t1", { url: "https://arxiv.org/pdf/2406.14058" });
			const text = asText(out);
			assert.match(text, /"page_count":2/);
			assert.match(text, /"size_class":"short"/);
			assert.match(text, /"path":"[^"]+\.pdf"/);
			const summary = (out as { details: { path: string } }).details;
			const written = await fs.readFile(summary.path);
			assert.equal(written.byteLength, PDF_BYTES.byteLength, "the PDF bytes land on disk");
		} finally {
			globalThis.fetch = realFetch;
		}
	});

	it("the follow-up tools read the download page-level (extract + search)", async () => {
		const dir = await newDir();
		const tools = createPdfReadTools(dir);
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			pdfResponse()) as typeof fetch;
		try {
			const out = await tools.web_fetch_pdf!.execute!("t2", { url: "https://example.com/paper.pdf" });
			const { path: pdfPath } = (out as { details: { path: string } }).details;

			const extract = asText(await tools.pdf_extract!.execute!("t3", { path: pdfPath, pages: "2" }));
			assert.match(extract, /--- Page 2 ---/);
			assert.match(extract, /orthogonal complement/);
			assert.ok(!extract.includes("page one"), "narrow specs extract only the asked pages");

			const search = asText(await tools.pdf_search!.execute!("t4", { path: pdfPath, query: "theorem" }));
			assert.match(search, /"page":2/);
		} finally {
			globalThis.fetch = realFetch;
		}
	});

	it("rejects non-PDF responses and non-http(s) schemes with error strings", async () => {
		const dir = await newDir();
		const tools = createPdfReadTools(dir);
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response("<html>just a page</html>", { headers: { "content-type": "text/html" } })) as typeof fetch;
		try {
			const notPdf = asText(await tools.web_fetch_pdf!.execute!("t5", { url: "https://example.com/doc" }));
			assert.match(notPdf, /web_fetch_pdf failed/);
			assert.match(notPdf, /Not a PDF/);
		} finally {
			globalThis.fetch = realFetch;
		}
		const ftp = asText(await tools.web_fetch_pdf!.execute!("t6", { url: "ftp://example.com/x.pdf" }));
		assert.match(ftp, /invalid URL/);
	});

	it("web_fetch points a .pdf URL served as octet-stream to web_fetch_pdf", async () => {
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response("%PDF-1.4", { headers: { "content-type": "application/octet-stream" } })) as typeof fetch;
		try {
			const out = asText(await webTools.web_fetch!.execute!("t9", { url: "https://example.edu/notes/lecture5.pdf" }));
			assert.match(out, /call web_fetch_pdf/);
		} finally {
			globalThis.fetch = realFetch;
		}
	});

	it("web_fetch_pdf and web_fetch hand the tool's own signal to fetch, so Stop cancels the download", async () => {
		const dir = await newDir();
		const tools = createPdfReadTools(dir);
		const realFetch = globalThis.fetch;
		const seen: (AbortSignal | null | undefined)[] = [];
		globalThis.fetch = (async (_url: string, init?: RequestInit) => {
			seen.push(init?.signal);
			init?.signal?.throwIfAborted();
			return pdfResponse();
		}) as typeof fetch;
		try {
			const stop = new AbortController();
			stop.abort();
			const pdfOut = asText(await tools.web_fetch_pdf!.execute!("t7", { url: "https://example.com/x.pdf" }, stop.signal));
			assert.match(pdfOut, /web_fetch_pdf failed.*aborted/);
			const pageOut = asText(await webTools.web_fetch!.execute!("t8", { url: "https://example.com/page" }, stop.signal));
			assert.match(pageOut, /web_fetch failed.*aborted/);
			assert.equal(seen.length, 2);
			assert.ok(seen.every((s) => s?.aborted), "each fetch got the aborted guard signal");
			assert.deepEqual(await fs.readdir(dir), [], "nothing was written for a stopped call");
		} finally {
			globalThis.fetch = realFetch;
		}
	});
});

describe("researcher pdf tools — the temp-dir wall", () => {
	it("path-taking tools refuse anything outside the job dir", async () => {
		const dir = await newDir();
		const tools = createPdfReadTools(dir);
		const outside = path.join(os.tmpdir(), "escape-attempt.pdf");
		const rel = asText(await tools.pdf_info!.execute!("t7", { path: outside }));
		assert.match(rel, /pdf_info failed: path must stay inside/);
		const traversal = asText(await tools.pdf_extract!.execute!("t8", { path: "../../etc/passwd", pages: "1" }));
		assert.match(traversal, /pdf_extract failed: path must stay inside/);
	});

	it("pdf_info reports per-page triage signals for a real download", async () => {
		const dir = await newDir();
		const tools = createPdfReadTools(dir);
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			pdfResponse()) as typeof fetch;
		try {
			const out = await tools.web_fetch_pdf!.execute!("t9", { url: "https://example.com/x.pdf" });
			const { path: pdfPath } = (out as { details: { path: string } }).details;
			const info = asText(await tools.pdf_info!.execute!("t10", { path: pdfPath }));
			assert.match(info, /"page_count":2/);
			assert.match(info, /"pages":\[/);
			assert.match(info, /"text_length":/);
		} finally {
			globalThis.fetch = realFetch;
		}
	});
});

describe("web_fetch — PDF pointer + source header", () => {
	it("a PDF URL points at web_fetch_pdf instead of dead-ending", async () => {
		const web = webTools;
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			pdfResponse()) as typeof fetch;
		try {
			const out = asText(await web.web_fetch!.execute!("t11", { url: "https://example.com/paper.pdf" }));
			assert.match(out, /PDF document/);
			assert.match(out, /web_fetch_pdf/);
		} finally {
			globalThis.fetch = realFetch;
		}
	});

	it("output carries the source line with HTTP status", async () => {
		const web = webTools;
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response("A plain text page with enough content to matter.", {
				headers: { "content-type": "text/plain" },
			})) as typeof fetch;
		try {
			const out = asText(await web.web_fetch!.execute!("t12", { url: "https://example.com/page" }));
			assert.match(out, /^Source: https:\/\/example\.com\/page \(HTTP 200\)/);
		} finally {
			globalThis.fetch = realFetch;
		}
	});

	it("a long page comes back as at most one work page", async () => {
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response("A line of a very long page.\n".repeat(3000), {
				headers: { "content-type": "text/plain" },
			})) as typeof fetch;
		try {
			const out = asText(await webTools.web_fetch!.execute!("t13", { url: "https://example.com/long" }));
			const [page] = out.split("\n\n[Truncated: the page goes on]");
			assert.ok(out.endsWith("[Truncated: the page goes on]"));
			assert.ok(Buffer.byteLength(page!) <= WORK_PAGE_BYTES);
		} finally {
			globalThis.fetch = realFetch;
		}
	});
});
