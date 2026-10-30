/**
 * Pictures and PDFs on screen: the composer's waiting files (previews, ✕,
 * the refusal line, the picture button, the busy hold) and the learner's
 * message with its thumbnails and PDF chips (a click shows a picture full
 * size; Esc or a click closes it).
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PanelComposer } from "../src/components/lesson/panel-composer.tsx";
import { PracticeDock } from "../src/components/practice-dock.tsx";
import { MessageRow } from "../src/components/lesson/message-row.tsx";
import type { AttachmentDraft } from "../src/components/lesson/attachment-tray.tsx";
import { HEIC_REFUSAL, newThinkingMessage, newUserMessage, pdfNote, projectView, type AttachmentPart } from "../src/core/index.ts";

const dom = parseHTML("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
});

const draft = (over: Partial<AttachmentDraft> = {}): AttachmentDraft => ({
	files: [
		{ id: "f1", attachment: { name: "graph.png", mimeType: "image/png", data: "iVBORw0KGgo=" } },
		{ id: "f2", attachment: { name: "Week 3 notes.pdf", mimeType: "application/pdf", data: "JVBERi0=" } },
	],
	error: null,
	add: () => {},
	remove: () => {},
	clear: () => {},
	restore: () => {},
	...over,
});

function composer(over: Partial<React.ComponentProps<typeof PanelComposer>> = {}) {
	return renderToStaticMarkup(
		<PanelComposer busy={false} value="" onChange={() => {}} onSend={() => {}} onStop={() => {}} canSend queuedSteers={[]} attachments={draft()} {...over} />,
	);
}

describe("the composer's waiting files", () => {
	it("previews each file above the box with an ✕, beside a picture button", () => {
		const html = composer();
		assert.match(html, /data-testid="attachment-tray"[\s\S]*data-testid="draft-image"[\s\S]*src="data:image\/png;base64,iVBORw0KGgo="/);
		assert.match(html, /data-testid="draft-pdf"[\s\S]*?Week 3 notes\.pdf/);
		assert.match(html, /aria-label="Remove graph\.png"/);
		assert.match(html, /aria-label="Remove Week 3 notes\.pdf"/);
		assert.ok(html.indexOf("attachment-tray") < html.indexOf("<textarea"), "the tray sits above the box");
		assert.match(html, /data-testid="attach-button"[^>]*aria-label="Add images or PDFs"|aria-label="Add images or PDFs"[^>]*data-testid="attach-button"/);
		assert.match(html, /type="file"[^>]*accept="image\/png,image\/jpeg,image\/gif,image\/webp,application\/pdf"/);
		assert.ok(!html.includes("attachment-note"), "no hold while idle");
	});

	it("no files: no tray, but the picture button stays", () => {
		const html = composer({ attachments: draft({ files: [] }) });
		assert.ok(!html.includes("attachment-tray"));
		assert.match(html, /data-testid="attach-button"/);
	});

	it("a refusal shows in the tray", () => {
		const html = composer({ attachments: draft({ files: [], error: HEIC_REFUSAL }) });
		assert.match(html, /data-testid="attachment-error"[^>]*>Can&#x27;t use HEIC photos yet\. Export as JPG\.</);
	});

	it("while the teacher writes, files wait with a hint and Send is off", () => {
		const html = composer({ busy: true, canSend: false });
		assert.match(html, /data-testid="attachment-note"[^>]*>Send pictures after the teacher finishes</);
		assert.match(html, /data-testid="composer-send"[^>]*disabled/);
		assert.ok(!html.includes("—"), "no em-dashes");
	});

	it("the practice panel has the same picture button", () => {
		const html = renderToStaticMarkup(<PracticeDock problemCallId="p1" input={{ statement: "Solve it." }} onSubmit={async () => true} />);
		assert.match(html, /data-testid="attach-button"/);
	});
});

const image: AttachmentPart = { type: "image", data: "QUJD", mimeType: "image/jpeg" };
const pdf = pdfNote("Week 3 notes.pdf", "/data/chats/chat_1/abc-Week 3 notes.pdf");

function row(message: Parameters<typeof projectView>[0][number]) {
	const view = projectView([message]).at(-1)!;
	return <MessageRow message={view} index={0} teachSeam={false} streamingLast={false} hideSteps={false} arrive={() => undefined} onOpenPlan={() => {}} />;
}

describe("the learner's message with files", () => {
	it("shows the text, a square thumbnail and a PDF chip", () => {
		const html = renderToStaticMarkup(row({ ...newUserMessage("see this", [image, pdf]), id: "u1" }));
		assert.match(html, /data-testid="user-message"[\s\S]*see this[\s\S]*data-testid="message-attachments"/);
		assert.match(html, /data-testid="message-image"[^>]*src="data:image\/jpeg;base64,QUJD"[^>]*class="[^"]*max-h-\[220px\]/);
		assert.ok(!/rounded/.test(html), "square corners");
		assert.match(html, /data-testid="message-pdf"[\s\S]*?Week 3 notes\.pdf/);
		assert.ok(!html.includes("[Attached PDF]"), "the note never shows as text");
	});

	it("a message with only files still reads as the learner's", () => {
		const html = renderToStaticMarkup(row({ ...newUserMessage("", [image]), id: "u2" }));
		assert.match(html, /data-testid="user-message"[\s\S]*data-testid="message-image"/);
	});

	it("a thinking card shows its files under it", () => {
		const html = renderToStaticMarkup(row({ ...newThinkingMessage("p1", "my work", [image]), id: "t1" }));
		assert.match(html, /data-testid="thinking-card"[\s\S]*data-testid="message-image"/);
	});

	it("without the desktop bridge the PDF chip can't open", () => {
		const html = renderToStaticMarkup(row({ ...newUserMessage("", [pdf]), id: "u3" }));
		assert.match(html, /data-testid="message-pdf"[^>]*disabled/);
	});

	it("a click shows the picture full size; Esc or a click closes it; a PDF click opens the file", async () => {
		const opened: string[] = [];
		(dom.window as unknown as { lh?: unknown }).lh = { openPath: async (p: string) => void opened.push(p) };
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		const overlay = () => document.querySelector('[data-testid="picture-overlay"]');
		try {
			await act(async () => root.render(row({ ...newUserMessage("", [image, pdf]), id: "u4" })));
			const thumb = () => host.querySelector<HTMLButtonElement>('[aria-label="Show picture full size"]')!;
			await act(async () => thumb().click());
			assert.ok(overlay(), "opens");
			const esc = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
			Object.defineProperty(esc, "key", { value: "Escape" });
			await act(async () => void document.dispatchEvent(esc));
			assert.equal(overlay(), null, "Esc closes");
			await act(async () => thumb().click());
			await act(async () => (overlay() as HTMLElement).click());
			assert.equal(overlay(), null, "a click closes");
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="message-pdf"]')!.click());
			assert.deepEqual(opened, ["/data/chats/chat_1/abc-Week 3 notes.pdf"]);
		} finally {
			await act(async () => root.unmount());
			host.remove();
			delete (dom.window as unknown as { lh?: unknown }).lh;
		}
	});
});
