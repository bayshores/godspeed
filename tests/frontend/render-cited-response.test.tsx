import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { MessageResponse, ToolContentResponse } from "../../src/frontend/components/ai-elements/message.tsx";
import { CitedResponse } from "../../src/frontend/components/citations/cited-response.tsx";
import { fileCiteMark } from "../../src/shared/core/index.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });

const FILE = "f_1a2b3c4d5e6f";
const slides = fileCiteMark(FILE, "p. 12", "Week 6 slides.pdf");
const count = (html: string, needle: string) => html.split(needle).length - 1;
const cited = (text: string) => renderToStaticMarkup(<CitedResponse text={text} />);

describe("source marks in teacher text", () => {
	it("a stored file mark is one numbered mark and one Sources row with the file and place", () => {
		const html = cited(`Big-O drops constants. ${slides}`);
		assert.equal(count(html, 'data-testid="cite-mark"'), 1);
		assert.match(html, /aria-label="Source 1, Week 6 slides\.pdf, p\. 12"/);
		assert.equal(count(html, 'data-testid="cite-row"'), 1);
		assert.match(html, /Sources/);
		assert.match(html, /Week 6 slides\.pdf, p\. 12/);
	});

	it("the same source cited twice gets one number and one row", () => {
		const html = cited(`One. ${slides} Two. ${slides}`);
		assert.equal(count(html, 'data-testid="cite-mark"'), 2);
		assert.equal(count(html, 'data-testid="cite-row"'), 1);
		assert.ok(!html.includes('aria-label="Source 2'));
	});

	it("a web mark is a link with the address", () => {
		const html = cited("Stacks are LIFO. [[https://example.com/stacks]]");
		assert.match(html, /<a [^>]*href="https:\/\/example\.com\/stacks"/);
		assert.match(html, /rel="noopener noreferrer"/);
		assert.equal(count(html, 'data-testid="cite-row"'), 1);
	});

	it("a passage id that was never checked shows nothing", () => {
		const html = cited(`Heaps are trees. [[${FILE}:7]]`);
		assert.equal(count(html, 'data-testid="cite-mark"'), 0);
		assert.ok(!html.includes("cite-list"));
		assert.ok(!html.includes(FILE));
	});

	it("a mark inside a code span is left as text", () => {
		const html = cited(`Write \`${slides}\` literally.`);
		assert.equal(count(html, 'data-testid="cite-mark"'), 0);
		assert.ok(!html.includes("cite-list"));
		assert.match(html, /Week 6 slides\.pdf/);
	});

	it("text with no marks renders what MessageResponse renders, with no Sources list", () => {
		const text = "Plain **text** with a list:\n\n- one\n- two";
		assert.equal(cited(text), renderToStaticMarkup(<MessageResponse>{text}</MessageResponse>));
	});

	it("a mark still being written while the reply streams in shows nothing", () => {
		const html = renderToStaticMarkup(<CitedResponse text={`Big-O drops constants. ${slides.slice(0, -6)}`} isAnimating />);
		assert.ok(!html.includes(FILE));
		assert.match(html, /Big-O drops constants\./);
	});

	it("question and option text never shows a mark", () => {
		const html = renderToStaticMarkup(<ToolContentResponse>{`Which is faster? ${slides}`}</ToolContentResponse>);
		assert.ok(!html.includes("[["));
		assert.ok(!html.includes("lh-cite"));
		assert.match(html, /Which is faster\?/);
	});
});

describe("opening a class file source", () => {
	/** The dialog a click on the source's row opens, with /api/cited answering `answer`. */
	async function opened(answer: Response, check: (dialog: Element, urls: string[]) => void) {
		const urls: string[] = [];
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async (url: string) => {
			urls.push(url);
			return answer;
		}) as typeof fetch;
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		try {
			await act(async () => root.render(<CitedResponse text={`Big-O drops constants. ${slides}`} />));
			const row = host.querySelector<HTMLButtonElement>('[data-testid="cite-row"] button')!;
			await act(async () => row.click());
			const dialog = document.querySelector('[data-testid="cite-dialog"]');
			assert.ok(dialog);
			check(dialog, urls);
		} finally {
			globalThis.fetch = realFetch;
			await act(async () => root.unmount());
			host.remove();
		}
	}
	const passage = (page: number | null, text: string) => new Response(JSON.stringify({ name: "Week 6 slides.pdf", range: "p. 12", page, text }), { status: 200 });

	it("shows the fetched passage text when there is no page", async () => {
		await opened(passage(null, "Drop the constants."), (dialog, urls) => {
			assert.deepEqual(urls, [`/api/cited/${FILE}?range=${encodeURIComponent("p. 12")}`]);
			assert.equal(dialog.querySelector('[data-testid="cite-text"]')?.textContent, "Drop the constants.");
			assert.match(dialog.textContent ?? "", /p\. 12/);
		});
	});

	it("shows the PDF page as an image", async () => {
		await opened(passage(12, "Drop the constants."), (dialog) => {
			const page = dialog.querySelector('[data-testid="cite-page"]');
			assert.equal(page?.getAttribute("src"), `/api/cited/${FILE}/page/12`);
			assert.equal(page?.getAttribute("alt"), "Page 12 of Week 6 slides.pdf");
			assert.equal(dialog.querySelector('[data-testid="cite-text"]'), null);
		});
	});

	it("says so when the place can't be found", async () => {
		await opened(new Response(JSON.stringify({ error: "No class has that file" }), { status: 404 }), (dialog) => {
			assert.match(dialog.querySelector('[data-testid="cite-gone"]')?.textContent ?? "", /can't find this place in your class files/);
		});
	});
});
