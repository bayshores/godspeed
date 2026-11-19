/**
 * The lesson while the teacher works: the desk at the foot of the lesson text in each state
 * (just opened, no agent, split into the plan beside the paper), the title's bubble left out,
 * the start key while no agent is here, Start again after a stopped first reply, and the landing:
 * the desk leaves before the reply shows, which then draws in, also when an answered question's
 * reply grows the same message.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ReadingPane } from "../../src/frontend/components/lesson/reading-pane.tsx";
import { AgentStatusContext, type AgentStatus } from "../../src/frontend/components/agent-status.tsx";
import { TeacherContext, type TeacherApi } from "../../src/frontend/components/teacher/teacher-context.ts";
import { newUserMessage, projectView, type AttachmentPart, type LhViewMessage } from "../../src/shared/core/index.ts";

const dom = parseHTML("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		disconnect() {}
	},
});

const TITLE = "Limits of sequences";
const card = (files: number): LhViewMessage => ({
	id: "card",
	role: "user",
	parts: [{ type: "data-space-context", data: { spaceId: "s", name: "Calculus", description: "", files: Array.from({ length: files }, (_, i) => ({ name: `f${i}.md`, kind: "study", path: null })) } }],
});
const first: LhViewMessage = { id: "u1", role: "user", parts: [{ type: "text", text: TITLE }] };
const teacher = (...parts: LhViewMessage["parts"]): LhViewMessage => ({ id: "a1", role: "assistant", parts });
const read = (id: string, path: string) => ({ type: "tool-read", toolCallId: id, state: "output-available", input: { path } });
const plan = { type: "tool-work_plan", toolCallId: "p", state: "output-available", input: { items: ["Read your notes", "Find the definition", "Write the lesson"], done: 1 } };

type Props = React.ComponentProps<typeof ReadingPane>;
const props = (over: Partial<Props> = {}): Props => ({
	spaceId: undefined,
	title: TITLE,
	assignment: null,
	messages: [card(5), first],
	phases: [],
	status: "submitted",
	busy: true,
	waitingForAgent: false,
	onStop: () => {},
	onStartAgain: () => {},
	goAhead: null,
	queuedSteers: [],
	arrivalsLive: false,
	pageMarks: new Map(),
	arrive: () => undefined,
	...over,
});
const pane = (over: Partial<Props> = {}) => renderToStaticMarkup(<ReadingPane {...props(over)} />);
const count = (html: string, pattern: RegExp) => [...html.matchAll(pattern)].length;

describe("the desk", () => {
	it("opens on a new lesson as a floating pile of paper with Stop under it, and no bubble for the title", () => {
		const out = pane();
		assert.match(out, /data-testid="agent-at-work" data-state="working"/);
		assert.match(out, /lh-float/);
		assert.equal(count(out, /lh-sheet lh-paper/g), 3, "the top sheet over two edges for five files");
		assert.match(out, /data-testid="agent-at-work"[\s\S]*data-testid="stop-turn"/);
		assert.doesNotMatch(out, /data-testid="user-message"/);
		assert.doesNotMatch(out, /Space context/, "the scaffolding card is not drawn");
		assert.doesNotMatch(out, /class="[^"]*empty:hidden/, "and leaves no hidden box behind");
	});

	it("says nothing the pill says: no Thinking, no teacher's name, no clock", () => {
		const out = pane();
		assert.doesNotMatch(out, /Thinking|Teacher|Quigley/);
		assert.doesNotMatch(out, /font-count/, "no count or clock while nothing is known");
	});

	it("has no gradient and no outline", () => {
		const out = pane({ messages: [card(30), first, teacher(plan, read("r1", "/h/notes.md"))] });
		assert.doesNotMatch(out, /gradient/);
		assert.doesNotMatch(out, /\bborder(-edge)?\b(?!-)/);
	});

	it("lies still and pale while no agent takes the turn", () => {
		const out = pane({ waitingForAgent: true });
		assert.match(out, /data-testid="agent-at-work" data-state="waiting"/);
		assert.doesNotMatch(out, /lh-float/);
	});

	it("splits into the plan beside the file being read, the spinner only on the current item and only the newest step under it", () => {
		const out = pane({ messages: [card(1), first, teacher(plan, read("r1", "/h/a.md"), read("r2", "/h/b.md"))] });
		assert.match(out, /data-testid="desk-plan"[\s\S]*Read your notes[\s\S]*Find the definition[\s\S]*opened b\.md[\s\S]*Write the lesson/);
		assert.equal(count(out, /role="status"/g), 1, "one spinner");
		assert.doesNotMatch(out, /opened a\.md/);
		assert.doesNotMatch(out, />Plan</);
		assert.match(out, /title="b\.md">b\.md</, "the file read now is on top");
	});

	it("with no plan, shows the newest step alone, with the spinner", () => {
		const out = pane({ messages: [card(1), first, teacher(read("r1", "/h/a.md"))] });
		assert.match(out, /data-testid="desk-plan"[\s\S]*role="status"[\s\S]*opened a\.md/);
	});
});

describe("the start key", () => {
	const off = { connected: false, teaching: false, helperHere: false, helperCovering: false, pendingWork: 1, pendingTurns: 1, helperWork: 0, claimedLessons: [] } as AgentStatus;
	const withStatus = (status: AgentStatus | null, panelStarts = false) =>
		renderToStaticMarkup(
			<AgentStatusContext.Provider value={status}>
				<TeacherContext.Provider value={{ name: "Quigley", panelStarts } as TeacherApi}>
					<ReadingPane {...props({ waitingForAgent: true })} />
				</TeacherContext.Provider>
			</AgentStatusContext.Provider>,
		);

	it("turns the teacher on from the still desk while no agent is here, with Stop quiet beside it", () => {
		assert.match(withStatus(off), /lh-btn lh-btn-main[^>]*>Turn on Quigley<\/button>[\s\S]*data-testid="stop-turn"[^>]*lh-btn-quiet/);
	});

	it("is not there while an agent is here, before the status is known, or while the teacher's panel shows its own", () => {
		assert.doesNotMatch(withStatus({ ...off, connected: true }), /Turn on/);
		assert.doesNotMatch(withStatus(null), /Turn on/);
		assert.doesNotMatch(withStatus(off, true), /Turn on/);
	});

	it("is only on the still desk", () => {
		const html = renderToStaticMarkup(
			<AgentStatusContext.Provider value={off}>
				<ReadingPane {...props()} />
			</AgentStatusContext.Provider>,
		);
		assert.doesNotMatch(html, /Turn on/);
	});
});

describe("the title's bubble", () => {
	it("keeps the files sent with the title, without the title's words", () => {
		const image: AttachmentPart = { type: "image", data: "QUJD", mimeType: "image/jpeg" };
		const withFile = projectView([{ ...newUserMessage(TITLE, [image]), id: "u1" }]);
		const out = pane({ messages: withFile, busy: false, status: "ready", onStop: null, onStartAgain: null });
		assert.match(out, /data-testid="user-message"[\s\S]*data-testid="message-image"/);
		assert.doesNotMatch(out, new RegExp(TITLE));
	});

	it("shows a first message that says more than the title", () => {
		const longer: LhViewMessage = { id: "u1", role: "user", parts: [{ type: "text", text: `${TITLE}, with proofs` }] };
		assert.match(pane({ messages: [longer] }), /data-testid="user-message"[\s\S]*with proofs/);
	});
});

describe("Start again", () => {
	const stopped = { busy: false, status: "ready" as const };
	it("steps in at the foot after a first reply was stopped with nothing written", () => {
		assert.match(pane(stopped), /data-testid="next-problem-button"[^>]*>Start again</);
	});

	it("is not there after an error, with a go-ahead waiting, or once the teacher wrote", () => {
		assert.doesNotMatch(pane({ ...stopped, onStartAgain: null }), /Start again/);
		assert.doesNotMatch(pane({ ...stopped, goAhead: { label: "Continue", onGo: () => {} } }), /Start again/);
		assert.doesNotMatch(pane({ ...stopped, messages: [card(1), first, teacher({ type: "text", text: "Here." })] }), /Start again/);
	});
});

describe("the reply landing", () => {
	it("waits for the desk to fade out, then draws in", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		const working = props({ messages: [card(1), first, teacher(read("r1", "/h/a.md"))], status: "streaming", arrive: () => "lh-rise" });
		const landed = { ...working, busy: false, status: "ready" as const, messages: [card(1), first, teacher(read("r1", "/h/a.md"), { type: "text", text: "First.\n\nSecond. [[https://example.com/a]]" })] };
		try {
			await act(async () => root.render(<ReadingPane {...working} />));
			await act(async () => root.render(<ReadingPane {...landed} />));
			assert.ok(host.querySelector("[data-desk-closing]") !== null, "the desk fades out");
			assert.ok(host.querySelector(".lh-source-passage") === null, "the reply waits until it has gone");
			await act(async () => {
				await new Promise((done) => setTimeout(done, 200));
			});
			assert.ok(host.querySelector("[data-testid=agent-at-work]") === null);
			assert.ok(host.querySelector(".lh-source-passage .lh-set") !== null, "the reply draws in block by block");
			assert.ok(host.querySelector("[data-testid=cite-list].lh-block-in") !== null, "Sources come after the text");
			assert.match(host.textContent ?? "", /First\.[\s\S]*Second\./);
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});

	it("holds back an answered question's reply that grows the same message until the desk has gone", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		const answered = { type: "tool-quiz", toolCallId: "q", state: "output-available", input: { type: "check", question: "Which?", options: [{ label: "A", value: "a" }] }, output: { kind: "quiz", answers: [{ index: 0, label: "A" }], correct: true } };
		const asked = teacher({ type: "text", text: "Try this." }, answered);
		const grown = (text: string) => teacher({ type: "text", text: "Try this." }, answered, { type: "step-start" }, { type: "text", text });
		const working = props({ messages: [card(1), first, asked], status: "streaming", arrive: () => "lh-rise" });
		try {
			await act(async () => root.render(<ReadingPane {...working} />));
			await act(async () => root.render(<ReadingPane {...working} messages={[card(1), first, grown("")]} />));
			assert.ok(host.querySelector("[data-testid=agent-at-work]") !== null, "an empty text part keeps the desk");
			await act(async () => root.render(<ReadingPane {...working} messages={[card(1), first, grown("Your pick holds.")]} />));
			assert.ok(host.querySelector("[data-desk-closing]") !== null, "the desk fades out");
			assert.doesNotMatch(host.textContent ?? "", /Your pick holds/, "the reply waits until it has gone");
			await act(async () => root.render(<ReadingPane {...working} busy={false} status="ready" messages={[card(1), first, grown("Your pick holds. More.")]} />));
			assert.doesNotMatch(host.textContent ?? "", /Your pick holds/, "still held while the desk leaves");
			await act(async () => {
				await new Promise((done) => setTimeout(done, 200));
			});
			assert.ok(host.querySelector("[data-testid=agent-at-work]") === null);
			assert.match(host.textContent ?? "", /Try this\.[\s\S]*Your pick holds\. More\./);
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});
});
