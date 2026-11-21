/**
 * The lesson while the teacher works: the pencil and Stop until the teacher plans or takes a
 * step, then the desk with the plan and the file it reads, the title's bubble left out,
 * the start key while no agent is here, no Start again at the foot of the text, and the landing:
 * the desk leaves before the reply shows, which then prints line by line, also when an answered
 * question's reply grows the same message.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ReadingPane } from "../../src/frontend/components/lesson/reading-pane.tsx";
import { titleEcho } from "../../src/frontend/components/lesson/wait-model.ts";
import { AgentStatusContext, type AgentStatus } from "../../src/frontend/components/agent-status.tsx";
import { TeacherContext, type TeacherApi } from "../../src/frontend/components/teacher/teacher-context.ts";
import { MessageRow, messageShows } from "../../src/frontend/components/lesson/message-row.tsx";
import { newNextMessage, newUserMessage, projectView, type AttachmentPart, type LhViewMessage } from "../../src/shared/core/index.ts";

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

// The page here lays nothing out: every line is 28 high and the reply's first paragraph is two lines.
const printed: { tag: string; delay: number; duration: number; easing: string }[] = [];
Object.assign(globalThis, { getComputedStyle: () => ({ lineHeight: "28px" }) });
Object.assign(dom.window.HTMLElement.prototype, {
	getBoundingClientRect(this: HTMLElement) {
		return { height: this.textContent?.startsWith("First.") ? 56 : 28 };
	},
	animate(this: HTMLElement, _frames: unknown, timing: { delay: number; duration: number; easing: string }) {
		printed.push({ tag: this.tagName, delay: timing.delay, duration: timing.duration, easing: timing.easing });
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
	echo: titleEcho(over.messages ?? [card(5), first], TITLE),
	messages: [card(5), first],
	phases: [],
	status: "submitted",
	busy: true,
	stoppedEmpty: false,
	waitingForAgent: false,
	onStop: () => {},
	queuedSteers: [],
	arrivalsLive: false,
	pageMarks: new Map(),
	arrive: () => undefined,
	...over,
});
const pane = (over: Partial<Props> = {}) => renderToStaticMarkup(<ReadingPane {...props(over)} />);
const count = (html: string, pattern: RegExp) => [...html.matchAll(pattern)].length;

describe("the desk", () => {
	it("opens on a new lesson as the pencil writing with Stop at the row's end, with no desk and no bubble for the title", () => {
		const out = pane();
		assert.match(out, /data-testid="pencil-line" data-state="working"[\s\S]*lh-pencil-ghost[\s\S]*lh-pencil-ink[\s\S]*lh-pencil-tip[\s\S]*data-testid="stop-turn"/);
		assert.doesNotMatch(out, /data-testid="agent-at-work"/);
		assert.doesNotMatch(out, /lh-paper/, "no paper before the teacher opens a file");
		assert.match(out, /data-testid="stop-turn"/);
		assert.doesNotMatch(out, /data-testid="user-message"/);
		assert.doesNotMatch(out, /Space context/, "the scaffolding card is not drawn");
		assert.doesNotMatch(out, /class="[^"]*empty:hidden/, "and leaves no hidden box behind");
	});

	it("says nothing the strip says: no Thinking, no teacher's name, no clock", () => {
		const out = pane();
		assert.doesNotMatch(out, /Thinking|Teacher|Quigley/);
		assert.doesNotMatch(out, /font-count/, "no count or clock while nothing is known");
	});

	it("has no gradient and no outline", () => {
		const out = pane({ messages: [card(30), first, teacher(plan, read("r1", "/h/notes.md"))] });
		assert.doesNotMatch(out, /gradient/);
		assert.doesNotMatch(out, /\bborder(-edge)?\b(?!-)/);
	});

	it("lays the pencil down, with no ink, while no agent takes the turn", () => {
		const out = pane({ waitingForAgent: true });
		assert.doesNotMatch(out, /data-testid="agent-at-work"/);
		assert.match(out, /data-testid="pencil-line" data-state="waiting"[\s\S]*lh-pencil-tip[\s\S]*data-testid="stop-turn"/);
		assert.doesNotMatch(out, /lh-pencil-ink|lh-pencil-ghost/);
	});

	it("has no pencil beside the desk, whose spinner is the one live thing, or at a stop", () => {
		const desk = pane({ messages: [card(1), first, teacher(read("r1", "/h/a.md"))] });
		assert.match(desk, /data-testid="agent-at-work"[\s\S]*data-testid="stop-turn"/);
		assert.doesNotMatch(desk, /pencil-line/);
		assert.doesNotMatch(pane({ onStop: null }), /pencil-line/);
	});

	it("splits into the plan beside the file being read, the spinner only on the current item and only the newest step under it", () => {
		const out = pane({ messages: [card(1), first, teacher(plan, read("r1", "/h/a.md"), read("r2", "/h/b.md"))] });
		assert.match(out, /data-testid="desk-plan"[\s\S]*Read your notes[\s\S]*Find the definition[\s\S]*opened b\.md[\s\S]*Write the lesson/);
		assert.equal(count(out, /role="status"/g), 1, "one spinner");
		assert.doesNotMatch(out, /opened a\.md/);
		assert.doesNotMatch(out, />Plan</);
		assert.doesNotMatch(out, /title="b\.md"/, "the plan names the file, so the paper carries no label");
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
		const out = pane({ messages: withFile, busy: false, status: "ready", onStop: null });
		assert.match(out, /data-testid="user-message"[\s\S]*data-testid="message-image"/);
		assert.doesNotMatch(out, new RegExp(TITLE));
	});

	it("shows a first message that says more than the title", () => {
		const longer: LhViewMessage = { id: "u1", role: "user", parts: [{ type: "text", text: `${TITLE}, with proofs` }] };
		assert.match(pane({ messages: [longer] }), /data-testid="user-message"[\s\S]*with proofs/);
	});
});

describe("whether the lesson text draws anything", () => {
	const shows = (messages: LhViewMessage[], open: string | null) => messages.some((m, i) => messageShows(m, i === titleEcho(messages, TITLE), open));
	const problem = { type: "tool-problem", toolCallId: "p1", state: "output-available", input: { statement: "Find x." } };
	const goAhead = projectView([newNextMessage()]);

	it("nothing for the space's card, the title, a go-ahead and the open problem", () => {
		assert.equal(shows([card(1), first, ...goAhead, teacher(problem)], "p1"), false);
		const row = goAhead.map((m, i) => <MessageRow key={i} message={m} spaceId={undefined} index={i} echo={false} teachSeam={false} streamingLast={false} hideSteps={false} pageMarks={new Map()} arrive={() => undefined} />);
		assert.equal(renderToStaticMarkup(<>{row}</>), '<div data-testid="go-ahead-mark" class="-mb-4"></div>', "a go-ahead's row is an empty mark");
	});

	it("something for the teacher's words, the learner's line, a file sent with the title and a problem no longer open", () => {
		assert.equal(shows([card(1), first, teacher({ type: "text", text: "Bits." }, problem)], "p1"), true);
		assert.equal(shows([card(1), first, teacher(problem), { id: "u2", role: "user", parts: [{ type: "text", text: "x = 2" }] }], "p1"), true);
		const image: AttachmentPart = { type: "image", data: "QUJD", mimeType: "image/jpeg" };
		assert.equal(shows(projectView([{ ...newUserMessage(TITLE, [image]), id: "u1" }]), null), true);
		assert.equal(shows([card(1), first, teacher(problem)], null), true);
	});
});

describe("Start again", () => {
	it("is not at the foot of the text after a first reply was stopped with nothing written: Your turn holds it", () => {
		assert.doesNotMatch(pane({ busy: false, status: "ready" }), /Start again|next-problem-button/);
	});

	it("leaves the text one line saying the reply was stopped, where the title's bubble is not drawn", () => {
		const html = pane({ busy: false, status: "ready", stoppedEmpty: true });
		assert.match(html, /data-testid="nothing-written"/);
		assert.doesNotMatch(html, /user-message/);
		assert.doesNotMatch(pane(), /nothing-written/);
	});
});

describe("the reply landing", () => {
	it("waits for the desk to fade out, then prints line by line", async () => {
		printed.length = 0;
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
			assert.deepEqual(
				printed.map((print) => print.tag),
				["P", "P", "DIV"],
				"the reply prints block by block, Sources after the text",
			);
			assert.deepEqual(
				printed.map((print) => [print.delay, print.duration, print.easing]),
				[
					[0, 120, "steps(2, jump-start)"],
					[120, 60, "steps(1, jump-start)"],
					[180, 60, "steps(1, jump-start)"],
				],
				"a line at a time, each block when the one before it ends",
			);
			assert.ok(host.querySelector(".lh-set") === null);
			assert.match(host.textContent ?? "", /First\.[\s\S]*Second\./);
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});

	it("under the pencil, holds the reply's words until its turn ends, so Stop never stands under them", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		const waiting = props();
		const words = { ...waiting, messages: [card(5), first, teacher({ type: "text", text: "Here it is." })] };
		try {
			await act(async () => root.render(<ReadingPane {...waiting} />));
			await act(async () => root.render(<ReadingPane {...words} />));
			assert.doesNotMatch(host.textContent ?? "", /Here it is/, "the words wait");
			assert.ok(host.querySelector("[data-testid=pencil-line]") !== null, "and the pencil writes on");
			await act(async () => root.render(<ReadingPane {...words} busy={false} status="ready" />));
			assert.match(host.textContent ?? "", /Here it is/);
			assert.ok(host.querySelector("[data-testid=stop-turn]") === null);
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});

	it("under the pencil, holds a reply's first part that leaves again before its words", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		const waiting = props();
		try {
			await act(async () => root.render(<ReadingPane {...waiting} />));
			const rows = host.querySelectorAll("[data-session-find-root] > *").length;
			await act(async () => root.render(<ReadingPane {...waiting} messages={[card(5), first, teacher({ type: "reasoning", text: "" })]} />));
			assert.equal(host.querySelectorAll("[data-session-find-root] > *").length, rows, "no row is added for it");
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});

	it("shows the words of a turn that goes on, with Stop under them", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		const waiting = props();
		try {
			await act(async () => root.render(<ReadingPane {...waiting} />));
			await act(async () => root.render(<ReadingPane {...waiting} messages={[card(5), first, teacher({ type: "text", text: "Here it is." })]} />));
			await act(async () => {
				await new Promise((done) => setTimeout(done, 450));
			});
			assert.match(host.textContent ?? "", /Here it is/);
			assert.ok(host.querySelector("[data-testid=stop-turn]") !== null);
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
		const grown = (text: string) => teacher({ type: "text", text: "Try this." }, answered, { type: "step-start" }, read("r1", "/h/a.md"), { type: "text", text });
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
