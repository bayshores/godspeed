import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { CitedResponse } from "../../src/frontend/components/citations/cited-response.tsx";
import { PageExcerpt } from "../../src/frontend/components/citations/page-excerpt.tsx";
import { fileCiteMark } from "../../src/shared/core/index.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });

const FILE = "f_1a2b3c4d5e6f";
const page14 = { kind: "file" as const, fileId: FILE, range: "p. 14", name: "Lecture 6.pdf", quote: "degree 12" };
const BOX = { x: 0.26642, y: 0.07494, w: 0.18562, h: 0.0197 };
const CODE = {
	kind: "lines",
	first: 10,
	lines: ["#include <stdio.h>", "", "int main(void) {", "\tint scores[4] = {90, 72, 85, 64};", "\tint *p = scores;", '\tprintf("%p %p\\n", (void *)p, (void *)(p + 1));', '\tprintf("%d %d\\n", *p, *(p + 1));', "\tfor (int i = 0; i < 4; i++) {", '\t\tprintf("%d\\n", *(p + i));', "\t}", "\treturn 0;", "}"],
	spans: [{ line: 15, start: 30, end: 45 }],
};

/** Renders `ui` with GET /api/cited answering `answer`; `check` sees the host and the asked URLs. */
async function rendered(ui: React.ReactElement, answer: unknown, check: (host: Element, urls: string[]) => void | Promise<void>) {
	const urls: string[] = [];
	const realFetch = globalThis.fetch;
	globalThis.fetch = (async (url: string) => {
		urls.push(url);
		return answer === "gone" ? new Response("{}", { status: 404 }) : new Response(JSON.stringify(answer), { status: 200 });
	}) as typeof fetch;
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	try {
		await act(async () => root.render(ui));
		await check(host, urls);
	} finally {
		globalThis.fetch = realFetch;
		await act(async () => root.unmount());
		host.remove();
	}
}
const excerpt = (cite = page14) => <PageExcerpt cite={cite} onOpen={() => {}} />;
const pdf = (marks: unknown) => ({ name: "Lecture 6.pdf", range: "p. 14", page: 14, text: "Overfitting with a degree 12 polynomial", marks });

describe("a topic's page", () => {
	it("asks for the place with the quote", async () => {
		await rendered(excerpt(), pdf(null), (_host, urls) => {
			assert.deepEqual(urls, [`/api/cited/${FILE}?range=${encodeURIComponent("p. 14")}&quote=${encodeURIComponent("degree 12")}`]);
		});
	});

	it("a PDF page keeps its 220px frame while it loads, so nothing below it moves", async () => {
		const realFetch = globalThis.fetch;
		globalThis.fetch = (() => new Promise(() => {})) as typeof fetch;
		const host = document.createElement("div");
		const root = createRoot(host);
		try {
			await act(async () => root.render(excerpt()));
			const frame = host.querySelector('[data-testid="page-excerpt-waiting"]');
			assert.match(frame?.getAttribute("style") ?? "", /height:\s*220px/);
			await act(async () => root.render(excerpt({ ...page14, name: "Heaps.docx", range: "lines 1–2" })));
			assert.equal(host.innerHTML, "", "only a PDF has a page to wait for");
		} finally {
			globalThis.fetch = realFetch;
			await act(async () => root.unmount());
		}
	});

	it("a PDF page is the page image 220 tall with the words on the highlighter", async () => {
		await rendered(excerpt(), pdf({ kind: "page", boxes: [BOX] }), (host) => {
			const frame = host.querySelector<HTMLElement>('[data-testid="page-excerpt"]')!;
			assert.equal(frame.tagName, "BUTTON");
			assert.match(frame.getAttribute("style") ?? "", /height:\s*220px/);
			const img = frame.querySelector("img")!;
			assert.equal(img.getAttribute("src"), `/api/cited/${FILE}/page/14`);
			assert.equal(img.getAttribute("alt"), 'Lecture 6, page 14, marked "degree 12"');
			const marks = frame.querySelectorAll<HTMLElement>('[data-testid="page-mark"]');
			assert.equal(marks.length, 1);
			const style = marks[0]!.getAttribute("style") ?? "";
			assert.match(style, /left:\s*26\.642%/);
			assert.match(style, /width:\s*18\.562%/);
		});
	});

	it("a scan or a quote not found shows the page unmarked", async () => {
		await rendered(excerpt(), pdf(null), (host) => {
			assert.equal(host.querySelector("img")?.getAttribute("alt"), "Lecture 6, page 14");
			assert.equal(host.querySelectorAll('[data-testid="page-mark"]').length, 0);
		});
	});

	it("code is the file's lines, numbered, with the expression marked", async () => {
		const cite = { kind: "file" as const, fileId: FILE, range: "lines 1–22", name: "lab3/arrays.c", quote: "(void *)(p + 1)" };
		await rendered(excerpt(cite), { name: "arrays.c", range: "lines 1–22", page: null, text: "…", marks: CODE }, (host) => {
			const frame = host.querySelector('[data-testid="page-excerpt"]')!;
			assert.equal(frame.getAttribute("aria-label"), "lab3/arrays.c, lines 10 to 21");
			const lines = [...host.querySelectorAll('[data-testid="code-line"]')];
			assert.equal(lines.length, 12);
			assert.match(lines[0]!.textContent ?? "", /^10#include <stdio\.h>$/);
			assert.match(lines[3]!.textContent ?? "", /^13 {4}int scores/);
			const marked = host.querySelectorAll("mark");
			assert.equal(marked.length, 1);
			assert.equal(marked[0]!.textContent, "(void *)(p + 1)");
			assert.ok(lines[5]!.contains(marked[0]!));
			// A long line wraps beside its number instead of running off the side.
			assert.ok(lines.every((line) => line.querySelector(".whitespace-pre-wrap.wrap-anywhere")));
		});
	});

	it("a .docx passage is a quote block with the words marked", async () => {
		const cite = { kind: "file" as const, fileId: FILE, range: "lines 1–2", name: "Heaps.docx", quote: "smallest key" };
		const text = "A heap keeps the smallest key on top.\nSo a heap is a tree, and a heap is quick.";
		await rendered(excerpt(cite), { name: "Heaps.docx", range: "lines 1–2", page: null, text, marks: { kind: "passage", start: 17, end: 29 } }, (host) => {
			const frame = host.querySelector('[data-testid="page-excerpt"]')!;
			assert.equal(frame.textContent, "A heap keeps the smallest key on top.");
			assert.equal(frame.querySelector("mark")?.textContent, "smallest key");
		});
	});

	it("a place that is gone, or a text file with nothing marked, shows nothing", async () => {
		await rendered(excerpt(), "gone", (host) => assert.equal(host.innerHTML, ""));
		await rendered(excerpt(), { name: "notes.txt", range: "lines 1–4", page: null, text: "words", marks: null }, (host) => assert.equal(host.innerHTML, ""));
	});
});

describe("the page in the teacher's text", () => {
	const mark = fileCiteMark(FILE, "p. 14", "Lecture 6.pdf", "degree 12");
	const text = `Here the curve misses the validation points.${mark}\n\nA curve swings like that when its weights are large.`;

	it("draws under the paragraph that cites it, before the rest", async () => {
		await rendered(<CitedResponse text={text} page={mark} />, pdf({ kind: "page", boxes: [BOX] }), (host) => {
			const html = host.innerHTML;
			const [para, frame, rest] = ["Here the curve misses", 'data-testid="page-excerpt"', "A curve swings"].map((s) => html.indexOf(s));
			assert.ok(para! >= 0 && para! < frame! && frame! < rest!, "paragraph, page, then the rest");
			assert.equal(host.querySelectorAll('[data-testid="cite-row"]').length, 1);
		});
	});

	it("text without the page mark draws no page and asks for nothing", async () => {
		await rendered(<CitedResponse text={text} />, pdf(null), (host, urls) => {
			assert.ok(host.querySelector('[data-testid="page-excerpt"]') === null);
			assert.deepEqual(urls, []);
		});
	});

	it("clicking the page opens the page dialog with the words marked", async () => {
		await rendered(<CitedResponse text={text} page={mark} />, pdf({ kind: "page", boxes: [BOX] }), async (host, urls) => {
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="page-excerpt"]')!.click());
			const dialog = document.querySelector('[data-testid="cite-dialog"]')!;
			assert.equal(dialog.querySelector('[data-testid="cite-page"]')?.getAttribute("src"), `/api/cited/${FILE}/page/14`);
			assert.equal(dialog.querySelectorAll('[data-testid="page-mark"]').length, 1);
			assert.ok(urls.every((u) => u.endsWith(`&quote=${encodeURIComponent("degree 12")}`)));
		});
	});

	it("the dialog marks a passage's words in its text", async () => {
		const docx = fileCiteMark(FILE, "lines 1–2", "Heaps.docx", "smallest key");
		const answer = { name: "Heaps.docx", range: "lines 1–2", page: null, text: "A heap keeps the smallest key on top.", marks: { kind: "passage", start: 17, end: 29 } };
		await rendered(<CitedResponse text={`A heap.${docx}`} />, answer, async (host) => {
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="cite-row"] button')!.click());
			const shown = document.querySelector('[data-testid="cite-dialog"] [data-testid="cite-text"]')!;
			assert.equal(shown.textContent, "A heap keeps the smallest key on top.");
			assert.equal(shown.querySelector("mark")?.textContent, "smallest key");
		});
	});
});
