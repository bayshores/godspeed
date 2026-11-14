/**
 * Pictures and PDFs on screen: the lesson box's waiting files (previews,
 * Remove, the refusal line, the picture button, the busy hold) and the
 * learner's message with its thumbnails and PDF chips (a click shows a
 * picture full size; Esc or a click closes it), the answers a picture alone
 * can send, and waiting files kept by box across leaving a lesson.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LessonBox } from "../../src/frontend/components/lesson/lesson-box.tsx";
import { MessageRow } from "../../src/frontend/components/lesson/message-row.tsx";
import { AttachButton, useAttachmentDraft, type AttachmentDraft } from "../../src/frontend/components/lesson/attachment-tray.tsx";
import { HEIC_REFUSAL, newAnswerResult, newUserMessage, pdfNote, projectView, type AttachmentPart, type LhMessage } from "../../src/shared/core/index.ts";
import { lessonBox, questionTurn, type BoxTurn } from "../../src/frontend/components/lesson/lesson-box-model.ts";
import { stubCodeMirrorDom } from "../math-box-dom.ts";
import { oldThinkingMessage } from "../old-records.ts";

const dom = parseHTML("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
});
stubCodeMirrorDom(dom);

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

function composer(over: { attachments?: AttachmentDraft; busy?: boolean; turn?: BoxTurn } = {}) {
	const attachments = over.attachments ?? draft();
	const view = lessonBox({ name: "Teacher", busy: over.busy ?? false, waitingForAgent: false, hasText: false, hasFiles: attachments.files.length > 0, turn: over.turn ?? { kind: "none" } });
	return renderToStaticMarkup(<LessonBox view={view} value="" onChange={() => {}} onAct={() => {}} onFocus={() => {}} queuedSteers={[]} attachments={attachments} boxRef={null} />);
}

describe("the lesson box's waiting files", () => {
	it("shows each file above the box with Remove", () => {
		const html = composer();
		assert.match(html, /data-testid="attachment-tray"[\s\S]*data-testid="draft-image"[\s\S]*src="data:image\/png;base64,iVBORw0KGgo="/);
		assert.match(html, /data-testid="draft-pdf"[\s\S]*?title="Week 3 notes\.pdf"[^>]*>Week 3 notes\.pdf/, "a long name shows in full on hover");
		assert.match(html, /aria-label="Remove graph\.png"/);
		assert.match(html, /aria-label="Remove Week 3 notes\.pdf"/);
		assert.ok(html.indexOf("attachment-tray") < html.indexOf('data-testid="math-box"'), "the tray sits above the box");
		assert.ok(!html.includes("attachment-note"), "no hold while idle");
	});

	it("no files: no tray", () => {
		assert.ok(!composer({ attachments: draft({ files: [] }) }).includes("attachment-tray"));
	});

	it("Add pictures or PDFs opens a picker for pictures and PDFs", () => {
		const html = renderToStaticMarkup(<AttachButton draft={draft()} />);
		assert.match(html, /data-testid="attach-button"[^>]*>.*?Add pictures or PDFs</);
		assert.match(html, /type="file"[^>]*accept="image\/png,image\/jpeg,image\/gif,image\/webp,application\/pdf"/);
	});

	it("a refusal shows in the tray", () => {
		const html = composer({ attachments: draft({ files: [], error: HEIC_REFUSAL }) });
		assert.match(html, /data-testid="attachment-error"[^>]*>Can&#x27;t use HEIC photos yet\. Export as JPG\.</);
	});

	it("while the teacher writes, files wait with a hint and Send stays off", () => {
		const html = composer({ busy: true });
		assert.match(html, /data-testid="attachment-note"[^>]*>Send pictures after the teacher finishes</);
		assert.match(html, /data-testid="composer-send"[^>]*disabled/);
		assert.ok(!html.includes("—"), "no em-dashes");
	});
});

describe("waiting files outlive their box", () => {
	// Node has no FileReader: read the file's bytes into a data URL.
	class TestFileReader {
		result: string | null = null;
		error: Error | null = null;
		onload: (() => void) | null = null;
		onerror: (() => void) | null = null;
		readAsDataURL(file: File) {
			void file.arrayBuffer().then((b) => {
				this.result = `data:${file.type};base64,${Buffer.from(b).toString("base64")}`;
				this.onload?.();
			});
		}
	}

	async function mountDraft(key: string | undefined) {
		const host = document.createElement("div");
		const root = createRoot(host);
		const box: { draft?: AttachmentDraft } = {};
		function Box() {
			box.draft = useAttachmentDraft(key);
			return null;
		}
		await act(async () => root.render(<Box />));
		return { box, unmount: () => act(async () => root.unmount()) };
	}

	it("a named box gets its files back after leaving and coming back, until they are sent; an unnamed box doesn't", async () => {
		(globalThis as Record<string, unknown>).FileReader = TestFileReader;
		try {
			const first = await mountDraft("chat_1");
			await act(async () => first.box.draft!.add([new File(["png"], "graph.png", { type: "image/png" })]));
			assert.deepEqual(first.box.draft!.files.map((f) => f.attachment.name), ["graph.png"]);
			await first.unmount();

			const back = await mountDraft("chat_1");
			assert.deepEqual(back.box.draft!.files.map((f) => f.attachment.name), ["graph.png"], "the lesson's files wait again");
			const other = await mountDraft("chat_2");
			assert.equal(other.box.draft!.files.length, 0, "another lesson has its own");
			await other.unmount();
			// A send that settles after the box is gone still clears the store.
			await back.unmount();
			await act(async () => back.box.draft!.clear());
			const after = await mountDraft("chat_1");
			assert.equal(after.box.draft!.files.length, 0);
			await after.unmount();

			const loose = await mountDraft(undefined);
			await act(async () => loose.box.draft!.add([new File(["png"], "a.png", { type: "image/png" })]));
			await loose.unmount();
			const looseBack = await mountDraft(undefined);
			assert.equal(looseBack.box.draft!.files.length, 0);
			await looseBack.unmount();
		} finally {
			delete (globalThis as Record<string, unknown>).FileReader;
		}
	});

	it("a picture alone can be the answer to a question in words, not to a choice", () => {
		const submit = (tool: string, input: unknown) => {
			const html = composer({ turn: questionTurn(tool, input, false) });
			return html.match(/<button[^>]*data-testid="question-submit"[^>]*>/)![0];
		};
		assert.doesNotMatch(submit("explain", { question: "Show your work.", correctAnswer: "4" }), /disabled/);
		assert.doesNotMatch(submit("ask_user_question", { question: "Which?" }), /disabled/);
		assert.match(submit("quiz", { question: "Pick one.", options: [{ label: "A" }, { label: "B" }], correctAnswer: "A" }), /disabled/);
	});
});

const image: AttachmentPart = { type: "image", data: "QUJD", mimeType: "image/jpeg" };
const pdf = pdfNote("Week 3 notes.pdf", "/data/chats/chat_1/abc-Week 3 notes.pdf");

function row(message: Parameters<typeof projectView>[0][number]) {
	const view = projectView([message]).at(-1)!;
	return <MessageRow message={view} spaceId={undefined} index={0} teachSeam={false} streamingLast={false} hideSteps={false} pageMarks={new Map()} arrive={() => undefined} onOpenPlan={() => {}} />;
}

describe("the learner's message with files", () => {
	it("shows the text, a thumbnail and a PDF chip", () => {
		const html = renderToStaticMarkup(row({ ...newUserMessage("see this", [image, pdf]), id: "u1" }));
		assert.match(html, /data-testid="user-message"[\s\S]*see this[\s\S]*data-testid="message-attachments"/);
		assert.match(html, /data-testid="message-image"[^>]*src="data:image\/jpeg;base64,QUJD"[^>]*class="[^"]*max-h-\[220px\]/);
		assert.match(html, /data-testid="message-pdf"[\s\S]*?title="Week 3 notes\.pdf"[^>]*>Week 3 notes\.pdf/, "a long name shows in full on hover");
		assert.ok(!html.includes("[Attached PDF]"), "the note never shows as text");
	});

	it("a message with only files still reads as the learner's", () => {
		const html = renderToStaticMarkup(row({ ...newUserMessage("", [image]), id: "u2" }));
		assert.match(html, /data-testid="user-message"[\s\S]*data-testid="message-image"/);
	});

	it("an answered question shows its files under the card", () => {
		const call = {
			id: "a1",
			role: "assistant",
			content: [{ type: "toolCall", id: "q1", name: "explain", arguments: { question: "Show your work.", correctAnswer: "4" } }],
			stopReason: "toolUse",
			api: "faux",
			provider: "faux",
			model: "m",
			usage: {},
			timestamp: 0,
		} as unknown as LhMessage;
		const answer = { kind: "explain", questionText: "Show your work.", dontKnow: false, answers: [], text: "see it" } as never;
		const view = projectView([call, newAnswerResult("q1", "explain", answer, [image])])[0]!;
		const html = renderToStaticMarkup(<MessageRow message={view} spaceId={undefined} index={0} teachSeam={false} streamingLast={false} hideSteps={false} pageMarks={new Map()} arrive={() => undefined} onOpenPlan={() => {}} />);
		assert.match(html, /data-testid="answered-card"[\s\S]*data-testid="message-image"/);
	});

	it("an old thinking card shows its files under it", () => {
		const html = renderToStaticMarkup(row({ ...oldThinkingMessage("p1", "my work", [image]), id: "t1" }));
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
			assert.equal(overlay()!.getAttribute("aria-modal"), "true", "Tab stays out of the lesson behind it");
			const esc = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
			Object.defineProperty(esc, "key", { value: "Escape" });
			await act(async () => void document.dispatchEvent(esc));
			assert.ok(overlay() === null, "Esc closes");
			await act(async () => thumb().click());
			await act(async () => (overlay() as HTMLElement).click());
			assert.ok(overlay() === null, "a click closes");
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="message-pdf"]')!.click());
			assert.deepEqual(opened, ["/data/chats/chat_1/abc-Week 3 notes.pdf"]);
		} finally {
			await act(async () => root.unmount());
			host.remove();
			delete (dom.window as unknown as { lh?: unknown }).lh;
		}
	});
});
