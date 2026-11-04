/**
 * The cheat sheet studio's parts: the top bar's status (working, waiting
 * for an agent, the paper), the older-sheet notice, what the learner asked
 * with Try again, the canvas (each version's pages as labeled artboards,
 * newest first, and the zoom toolbar), and the prompt box (Enter sends, a
 * refused send keeps the text, Stop puts the prompt back).
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { newCheatSheet, type CheatSheetView, type SheetCard, type SheetVersion } from "../src/core/index.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, self: globalThis });

const { OlderSheet, StudioStatus } = await import("../src/components/cheat-sheet/studio-states.tsx");
const { PromptBox, PromptHistory } = await import("../src/components/cheat-sheet/prompt-box.tsx");
const { SheetCanvas } = await import("../src/components/cheat-sheet/sheet-canvas.tsx");
const { SheetCardView } = await import("../src/components/cheat-sheet/class-sheets.tsx");

const A4 = { widthPt: 595.28, heightPt: 841.89 };
const versions: SheetVersion[] = [
	{ n: 1, prompt: "A4", at: "2026-11-03T10:00:00.000Z", pages: [A4] },
	{ n: 2, prompt: "double sided, and a flowchart", at: "2026-11-03T11:00:00.000Z", pages: [A4, A4] },
];

const view = (over: Partial<CheatSheetView> = {}): CheatSheetView => ({
	className: "CSE 21",
	deadlineName: "Midterm",
	date: "2026-11-04",
	sheet: newCheatSheet("ddl_1", "t"),
	running: null,
	error: null,
	...over,
});

const status = (v: CheatSheetView, agentGone = false) => renderToStaticMarkup(<StudioStatus view={v} agentName="Claude Code" agentGone={agentGone} onStop={() => {}} />);

describe("the studio's status", () => {
	it("says what the agent is doing, or that none is connected, with Stop", () => {
		assert.match(status(view({ running: { kind: "make", prompt: "A4" } })), /Claude Code is making your sheet.*Stop/);
		assert.match(status(view({ running: { kind: "change", prompt: "bigger" } })), /Claude Code is changing your sheet/);
		const waiting = status(view({ running: { kind: "make", prompt: "A4" } }), true);
		assert.match(waiting, /No agent connected.*Stop/);
		assert.doesNotMatch(waiting, /making/);
	});

	it("names the newest version's paper", () => {
		assert.match(status(view()), /Not made yet/);
		assert.match(status(view({ sheet: { ...newCheatSheet("ddl_1", "t"), versions } })), /A4, front and back/);
	});

	it("says an older sheet can't be shown, with one button to make it again", () => {
		assert.match(renderToStaticMarkup(<OlderSheet onRemake={() => {}} />), /made by an older godspeed.*data-testid="cheat-sheet-remake"[^>]*>Make it again/);
	});
});

describe("what the learner asked", () => {
	const history = (over: Partial<React.ComponentProps<typeof PromptHistory>> = {}) =>
		renderToStaticMarkup(<PromptHistory prompts={[{ text: "A4 please", at: "t", files: ["notes.pdf"] }]} running={null} error={null} agentName="Claude Code" waiting={false} onRetry={() => {}} {...over} />);

	it("lists each prompt with its files, then the one the agent is on", () => {
		const html = history({ running: "and a flowchart" });
		assert.match(html, /A4 please.*With notes\.pdf/);
		assert.match(html, /and a flowchart.*Claude Code is on it/);
		assert.match(history({ running: "x", waiting: true }), /Waiting for an agent/);
	});

	it("says why the last one failed, with Try again", () => {
		assert.match(history({ error: "the agent never sent the cheat sheet" }), /Claude Code couldn&#x27;t finish that\..*the agent never sent the cheat sheet.*Try again/);
		assert.equal(renderToStaticMarkup(<PromptHistory prompts={[]} running={null} error={null} agentName="x" waiting={false} onRetry={() => {}} />), "");
	});
});

describe("the canvas", () => {
	const html = renderToStaticMarkup(<SheetCanvas versions={versions} pdfUrl={(n) => `/pdf/${n}`} labelFor={(v, newest) => `${newest ? "Current" : "Earlier"} · ${v.prompt}`} inset={372} />);

	it("puts every version's pages on the canvas at their size, newest first, each labeled", () => {
		const pages = html.match(/data-testid="cheat-sheet-page"[^>]*style="[^"]*"/g)!;
		assert.equal(pages.length, 3);
		assert.match(pages[0]!, /left:0;top:0;width:793\.7\d*px;height:1122\.5\d*px/);
		assert.match(pages[1]!, /left:841\.7\d*px/);
		const labels = [...html.matchAll(/data-testid="cheat-sheet-version"[^>]*>([^<]*)</g)].map((m) => m[1]);
		assert.deepEqual(labels, ["Current · double sided, and a flowchart", "Earlier · A4"]);
		assert.match(html, />Front<\/p>.*>Back<\/p>.*>Page 1<\/p>/);
	});

	it("has zoom out, the zoom (back to 100%), zoom in and Zoom to fit, all clickable", () => {
		const bar = /data-testid="cheat-sheet-zoom"[\s\S]*$/.exec(html)![0];
		assert.deepEqual([...bar.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]), ["Zoom out", "Zoom to 100%", "Zoom in", "Zoom to fit"]);
		assert.match(bar, />100%</);
	});
});

describe("a class's cheat sheet cards", () => {
	const card = (over: Partial<SheetCard> = {}): SheetCard => ({ deadlineId: "ddl_1", name: "Midterm", kind: "exam", date: "2026-11-04", time: "09:00", past: false, status: "none", version: null, ...over });
	const render = (c: SheetCard, show: { label: string; run: () => void } | null = null) =>
		renderToStaticMarkup(<SheetCardView card={c} classId="cls_1" agentName="Claude Code" onRemake={() => {}} show={show} />);

	it("a made sheet: its first page's preview from the real PDF, its paper and when it was made, opening the studio", () => {
		const html = render(card({ status: "made", version: versions[1]! }));
		assert.match(html, /href="\/class\/deadline\/ddl_1\/cheat-sheet"/);
		assert.match(html, /data-testid="cheat-sheet-thumb"[^>]*style="width:134px;height:190px"/);
		assert.match(html, /Midterm<\/h3>.*Exam · Wed Nov 4 9:00 AM/);
		assert.match(html, /A4, front and back · made Nov 3/);
		assert.doesNotMatch(html, /cheat-sheet-show-file/, "no file browser in a plain browser");
		assert.match(render(card({ status: "made", version: versions[1]! }), { label: "Show in Finder", run: () => {} }), /data-testid="cheat-sheet-show-file"[^>]*>Show in Finder/);
	});

	it("being made: the working state, over the last version's preview when there is one", () => {
		assert.match(render(card({ status: "making" })), /Claude Code is making it/);
		const changing = render(card({ status: "making", version: versions[0]! }));
		assert.match(changing, /Claude Code is changing it/);
		assert.match(changing, /cheat-sheet-thumb/);
	});

	it("an older sheet says so with Make it again; none says so with Make one; a newer one asks for an update", () => {
		const older = render(card({ status: "older" }));
		assert.match(older, /Made by an older godspeed.*data-testid="cheat-sheet-remake"[^>]*>Make it again/);
		assert.doesNotMatch(older, /cheat-sheet-thumb/);
		assert.match(render(card()), /No cheat sheet yet.*data-testid="cheat-sheet-make"[^>]*>Make one/);
		assert.match(render(card({ status: "newer" })), /Update godspeed to see it/);
	});
});

describe("the prompt box", () => {
	async function mount(props: Partial<React.ComponentProps<typeof PromptBox>> & Pick<React.ComponentProps<typeof PromptBox>, "onSend">) {
		Object.assign(globalThis, { Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
		const { createRoot } = await import("react-dom/client");
		const host = document.createElement("div");
		document.body.appendChild(host);
		const root = createRoot(host);
		const render = (over: Partial<React.ComponentProps<typeof PromptBox>> = {}) =>
			act(async () => root.render(<PromptBox deadlineId="ddl_box" label="Make" placeholder="What do you want?" running={null} onStop={() => {}} {...props} {...over} />));
		await render();
		const field = () => host.querySelector("textarea")!;
		// The box's own handlers: linkedom's text field events don't reach React here.
		const handlers = () => Object.entries(field()).find(([k]) => k.startsWith("__reactProps"))![1] as { onChange: (e: unknown) => void; onKeyDown: (e: unknown) => void };
		const type = (value: string) => act(async () => handlers().onChange({ target: { value } }));
		const key = (k: string, shiftKey = false) => act(async () => handlers().onKeyDown({ key: k, shiftKey, nativeEvent: { isComposing: false }, preventDefault() {} }));
		return { host, field, type, key, render, done: () => act(async () => root.unmount()) };
	}

	it("Enter sends, Shift+Enter doesn't; a refused send keeps the text and says why", async () => {
		const sent: string[] = [];
		let answer: string | null = "Your agent is still working on this cheat sheet.";
		const box = await mount({
			onSend: async (text) => {
				sent.push(text);
				return answer;
			},
		});
		await box.type("double sided A4");
		await box.key("Enter", true);
		assert.deepEqual(sent, []);
		await box.key("Enter");
		assert.deepEqual(sent, ["double sided A4"]);
		assert.equal(box.field().value, "double sided A4");
		assert.match(box.host.innerHTML, /role="alert"[^>]*>Your agent is still working/);
		answer = null;
		await box.key("Enter");
		assert.equal(box.field().value, "");
		await box.done();
	});

	it("shows Stop while the agent works, which puts the prompt back in an empty box", async () => {
		let stopped = 0;
		const box = await mount({ onSend: async () => null, running: "a flowchart for any problem", onStop: () => stopped++ });
		const stop = box.host.querySelector<HTMLButtonElement>('[data-testid="cheat-sheet-stop"]')!;
		assert.ok(stop);
		assert.equal(box.host.querySelector('[data-testid="cheat-sheet-send"]'), null);
		await act(async () => (Object.entries(stop).find(([k]) => k.startsWith("__reactProps"))![1] as { onClick: () => void }).onClick());
		assert.equal(stopped, 1);
		assert.equal(box.field().value, "a flowchart for any problem");
		await box.done();
	});
});
