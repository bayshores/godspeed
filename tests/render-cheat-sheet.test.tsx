/**
 * The cheat sheet studio's parts: the top bar's status (working, waiting
 * for an agent, the paper and what runs over), what the learner asked
 * with Try again, the pages in sandboxed frames, and the prompt box
 * (Enter sends, a refused send keeps the text, Stop puts the prompt back).
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { newCheatSheet, type CheatSheetDoc, type CheatSheetView } from "../src/core/index.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, self: globalThis });

const { StudioStatus } = await import("../src/components/cheat-sheet/studio-states.tsx");
const { PromptBox, PromptHistory } = await import("../src/components/cheat-sheet/prompt-box.tsx");
const { SheetPages } = await import("../src/components/cheat-sheet/sheet-pages.tsx");

const doc: CheatSheetDoc = { widthIn: 8.27, heightIn: 11.69, css: "", pages: ["<p>front $x^2$</p>", "<p onclick='x()'>back</p><script>bad()</script>"] };

const view = (over: Partial<CheatSheetView> = {}): CheatSheetView => ({
	className: "CSE 21",
	deadlineName: "Midterm",
	date: "2026-11-04",
	sheet: newCheatSheet("ddl_1", "t"),
	running: null,
	error: null,
	...over,
});

const status = (v: CheatSheetView, over: number[] = [], agentGone = false) =>
	renderToStaticMarkup(<StudioStatus view={v} agentName="Claude Code" agentGone={agentGone} over={over} onStop={() => {}} />);

describe("the studio's status", () => {
	it("says what the agent is doing, or that none is connected, with Stop", () => {
		assert.match(status(view({ running: { kind: "make", prompt: "A4" } })), /Claude Code is writing your sheet.*Stop/);
		assert.match(status(view({ running: { kind: "change", prompt: "bigger" } })), /Claude Code is changing your sheet/);
		const waiting = status(view({ running: { kind: "make", prompt: "A4" } }), [], true);
		assert.match(waiting, /No agent connected.*Stop/);
		assert.doesNotMatch(waiting, /writing/);
	});

	it("names the paper, and the pages that run over", () => {
		assert.match(status(view()), /Not made yet/);
		const made = view({ sheet: { ...newCheatSheet("ddl_1", "t"), doc } });
		assert.match(status(made), /A4, front and back/);
		assert.doesNotMatch(status(made), /runs over/);
		assert.match(status(made, [2]), /Page 2 runs over/);
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

describe("the pages", () => {
	it("shows each page in a frame with no scripts, its HTML cleaned and math rendered, captioned Front and Back", () => {
		const html = renderToStaticMarkup(<SheetPages doc={doc} onOverflow={() => {}} />);
		const frames = html.match(/<iframe[^>]*>/g)!;
		assert.equal(frames.length, 2);
		for (const f of frames) {
			assert.match(f, /sandbox="allow-same-origin"/);
			assert.match(f, /style="width:793\.92px;height:1122\.24px"/);
		}
		assert.match(frames[0]!, /srcDoc="[^"]*class=&quot;katex/);
		assert.doesNotMatch(frames[1]!, /onclick|bad\(\)/);
		assert.match(html, /Front<\/figcaption>[\s\S]*Back<\/figcaption>/);
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
