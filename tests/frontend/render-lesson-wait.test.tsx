/**
 * The lesson while the teacher works: the desk from the start, with its sentence, its steps and
 * the files as a stack, the title's bubble left out, the start key while no agent is here, no
 * Start again at the foot of the text, and the reply as it is written: its words wait a moment
 * under the desk, the desk leaves before they show, then they grow in place with Stop under them,
 * a step after them brings the desk back, and Stop fades out when the turn ends.
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
import { NO_LESSON_WORK, type DeskFile, type LessonWork, newNextMessage, newUserMessage, projectView, type AttachmentPart, type LhViewMessage } from "../../src/shared/core/index.ts";

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

// Anything that would animate from code says so: the reply's words never do.
const animated: string[] = [];
Object.assign(dom.window.HTMLElement.prototype, {
	animate(this: HTMLElement) {
		animated.push(this.tagName);
		return { finished: new Promise(() => {}), cancel() {}, pause() {}, play() {} };
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

type Props = React.ComponentProps<typeof ReadingPane>;
const props = (over: Partial<Props> = {}): Props => ({
	spaceId: undefined,
	stepNumbers: new Map(),
	echo: titleEcho(over.messages ?? [card(5), first], TITLE),
	messages: [card(5), first],
	phases: [],
	status: "submitted",
	busy: true,
	stoppedEmpty: false,
	waitingForAgent: false,
	work: NO_LESSON_WORK,
	onStop: () => {},
	queuedSteers: [],
	arrivalsLive: false,
	pageMarks: new Map(),
	arrive: () => undefined,
	onDesk: () => {},
	...over,
});
const pane = (over: Partial<Props> = {}) => renderToStaticMarkup(<ReadingPane {...props(over)} />);
const count = (html: string, pattern: RegExp) => [...html.matchAll(pattern)].length;

describe("the desk", () => {
	type DeskStep = LessonWork["steps"][number];
	const step = (id: string, text: string, over: Partial<DeskStep> = {}): DeskStep => ({ id, at: "2026-11-23T22:20:33.000Z", text, call: null, reads: null, ...over });
	const pdf = (name: string): DeskFile => ({ name, path: `/h/${name}`, kind: "pdf" });
	const work = (over: Partial<LessonWork> = {}): LessonWork => ({ ...NO_LESSON_WORK, live: true, cause: "first", taken: true, ...over });

	it("opens on a new lesson as the desk: what the teacher does, the pencil writing on the current tile, Stop at its foot, no bubble for the title", () => {
		const out = pane({ work: work() });
		assert.match(out, /data-testid="agent-at-work" data-state="working"[\s\S]*Teacher is getting your first step ready\.[\s\S]*data-testid="desk-plan"[\s\S]*data-testid="pencil-line" data-state="working"[\s\S]*lh-pencil-ink[\s\S]*data-testid="stop-turn"/);
		assert.doesNotMatch(out, /data-testid="desk-stack"/, "no files: no stack");
		assert.doesNotMatch(out, /data-testid="user-message"/);
		assert.doesNotMatch(out, /Space context/, "the scaffolding card is not drawn");
		assert.doesNotMatch(out, /class="[^"]*empty:hidden/, "and leaves no hidden box behind");
	});

	it("says what the teacher does in the teacher's name, and keeps the sentence's line before the server's first word", () => {
		const named = renderToStaticMarkup(
			<TeacherContext.Provider value={{ name: "Quigley" } as TeacherApi}>
				<ReadingPane {...props({ work: work({ cause: "answer" }) })} />
			</TeacherContext.Provider>,
		);
		assert.match(named, /Quigley is reading your answer\./);
		assert.match(pane(), /data-testid="desk-head" class="[^"]*min-h-\[1lh\][^"]*"><\/p>/, "an empty line, kept");
		assert.doesNotMatch(pane({ work: work() }), /Thinking|font-count/, "no status word and no clock");
	});

	it("has no gradient and no outline", () => {
		const out = pane({ work: work({ steps: [step("1", "Reading a.pdf", { reads: { ...pdf("a.pdf"), from: null, to: null, page: 1 } })], files: [pdf("a.pdf"), pdf("b.pdf")] }) });
		assert.doesNotMatch(out, /gradient/);
		assert.doesNotMatch(out, /\bborder(-edge)?\b(?!-)/);
	});

	it("lays the pencil down, with no ink, while no agent takes the turn", () => {
		const out = pane({ waitingForAgent: true, work: work({ taken: false }) });
		assert.match(out, /data-testid="agent-at-work" data-state="waiting"[\s\S]*Waiting for Teacher to start\.[\s\S]*data-testid="pencil-line" data-state="waiting"[\s\S]*lh-pencil-tip[\s\S]*data-testid="stop-turn"/);
		assert.doesNotMatch(out, /lh-pencil-ink|lh-pencil-ghost/);
	});

	it("lists the steps in the server's words, the older checked and the pencil only on the newest", () => {
		const out = pane({ work: work({ steps: [step("1", "Looking at CSE 29"), step("2", "Searching your graph for “pointers”")] }) });
		assert.match(out, /data-testid="desk-plan"[\s\S]*Looking at CSE 29[\s\S]*lh-pencil-mark[\s\S]*Searching your graph for “pointers”/);
		assert.equal(count(out, /lh-pencil-tip/g), 1, "one pencil");
		assert.doesNotMatch(out, /data-testid="pencil-line"/, "the handwriting gave way to the first step");
		assert.doesNotMatch(out, /role="status"/, "no spinner");
	});

	it("with a plan, shows its items and the newest step under the current one", () => {
		const out = pane({ work: work({ plan: { items: ["Read your notes", "Find the definition", "Write the lesson"], done: 1 }, steps: [step("1", "Reading a.md"), step("2", "Reading b.md")] }) });
		assert.match(out, /Read your notes[\s\S]*Find the definition[\s\S]*Reading b\.md[\s\S]*Write the lesson/);
		assert.doesNotMatch(out, /Reading a\.md/);
	});

	it("lays the files on the desk as a stack, still and dim before a read, the one being read in front", () => {
		const files = [pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf")];
		const before = pane({ work: work({ files }) });
		assert.match(before, /data-testid="desk-stack"[\s\S]*c\.pdf[\s\S]*b\.pdf[\s\S]*a\.pdf[\s\S]*data-still="true"/, "back first, the front sheet last, its pages still");
		assert.doesNotMatch(before, /data-lifted/);
		const reads = { ...pdf("c.pdf"), from: null, to: null, page: 2 };
		const reading = pane({ work: work({ files, steps: [step("1", "Reading c.pdf, page 2", { reads })] }) });
		assert.match(reading, /b\.pdf[\s\S]*a\.pdf[\s\S]*data-path="\/h\/c\.pdf" data-lifted=""/, "the file read moves to the front");
		assert.doesNotMatch(reading, /data-still/);
	});

	it("shows no paper for a file it cannot draw, only the sheet's name", () => {
		const out = pane({ work: work({ files: [{ name: "Week 8.pptx", path: "/h/Week 8.pptx", kind: "other" }] }) });
		assert.match(out, /data-testid="desk-stack"[\s\S]*Week 8\.pptx/);
		assert.doesNotMatch(out, /lh-desk-pages/);
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
		const row = goAhead.map((m, i) => <MessageRow key={i} message={m} spaceId={undefined} index={i} echo={false} teachSeam={false} streamingLast={false} hiddenCalls={null} pageMarks={new Map()} arrive={() => undefined} />);
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

describe("the reply as it is written", () => {
	const wait = (ms: number) => act(async () => void (await new Promise((done) => setTimeout(done, ms))));
	type DeskStep = LessonWork["steps"][number];
	const step = (id: string, text: string): DeskStep => ({ id, at: "2026-11-23T22:20:33.000Z", text, call: null, reads: null });
	const working = (steps: DeskStep[]): LessonWork => ({ ...NO_LESSON_WORK, live: true, cause: "ask", taken: true, steps });

	it("waits for the desk to fade out, then grows in place as the words come, with Stop under them, never printed", async () => {
		animated.length = 0;
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		const at = (text: string) => props({ messages: [card(1), first, teacher({ type: "text", text })], status: "streaming", arrive: () => "lh-rise" });
		try {
			await act(async () => root.render(<ReadingPane {...props({ messages: [card(1), first], arrive: () => "lh-rise" })} />));
			await act(async () => root.render(<ReadingPane {...at("First")} />));
			await wait(450);
			assert.ok(host.querySelector("[data-desk-closing]") !== null, "the desk fades out");
			assert.ok(host.querySelector(".lh-source-passage") === null, "the words wait until it has gone");
			await wait(200);
			assert.ok(host.querySelector("[data-testid=agent-at-work]") === null);
			const passage = host.querySelector(".lh-source-passage");
			assert.match(passage?.textContent ?? "", /First/);
			assert.ok(passage?.querySelector(".lh-streaming") !== null, "the writing mark at the words' end");
			const stop = host.querySelector("[data-testid=stop-turn]");
			assert.ok(stop !== null, "Stop under the words");
			await act(async () => root.render(<ReadingPane {...at("First words, and more.")} />));
			assert.ok(host.querySelector(".lh-source-passage") === passage, "the same passage grows");
			assert.match(passage?.textContent ?? "", /First words, and more\./);
			assert.ok(host.querySelector("[data-testid=stop-turn]") === stop, "Stop stays where it was");
			assert.deepEqual(animated, [], "nothing prints");
			await act(async () => root.render(<ReadingPane {...at("First words, and more.")} busy={false} status="ready" />));
			assert.equal(host.querySelector("[data-testid=stop-turn]")?.closest("[data-state]")?.getAttribute("data-state"), "closed", "Stop fades out when the turn ends");
			assert.ok(host.querySelector(".lh-source-passage .lh-streaming") === null);
			await wait(200);
			assert.ok(host.querySelector("[data-testid=stop-turn]") === null, "and goes");
			assert.ok(host.querySelector(".lh-source-passage") === passage, "the words stay as they were drawn");
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});

	it("brings the desk back under the words for a step after them, and sends it away when words come again", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		const at = (text: string, steps: DeskStep[]) => props({ messages: [card(1), first, teacher({ type: "text", text })], status: "streaming", work: working(steps), arrive: () => "lh-rise" });
		const desk = () => host.querySelector("[data-testid=agent-at-work]");
		try {
			await act(async () => root.render(<ReadingPane {...props({ messages: [card(1), first], work: working([step("1", "Looking at Calculus")]) })} />));
			await act(async () => root.render(<ReadingPane {...at("Let me look at your notes.", [step("1", "Looking at Calculus")])} />));
			await wait(450);
			await wait(200);
			assert.ok(desk() === null, "the words took the desk's place");
			const passage = host.querySelector(".lh-source-passage");
			await act(async () => root.render(<ReadingPane {...at("Let me look at your notes.", [step("1", "Looking at Calculus"), step("2", "Reading notes.md")])} />));
			assert.ok(desk() !== null, "a step after the words brings the desk back");
			assert.match(desk()?.textContent ?? "", /Reading notes\.md/);
			assert.ok(host.querySelector(".lh-source-passage") === passage, "under the words, which stay");
			assert.equal(host.querySelectorAll("[data-testid=stop-turn]").length, 1, "one Stop, on the desk");
			await act(async () => root.render(<ReadingPane {...at("Let me look at your notes. Found it.", [step("1", "Looking at Calculus"), step("2", "Reading notes.md")])} />));
			assert.ok(desk() !== null, "new words wait a moment under the desk");
			assert.doesNotMatch(host.textContent ?? "", /Found it/);
			await wait(450);
			await wait(200);
			assert.ok(desk() === null);
			assert.match(host.querySelector(".lh-source-passage")?.textContent ?? "", /Found it\./);
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});

	it("under the desk, holds the reply's words until its turn ends, so Stop never stands under them", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		const waiting = props();
		const words = { ...waiting, messages: [card(5), first, teacher({ type: "text", text: "Here it is." })] };
		try {
			await act(async () => root.render(<ReadingPane {...waiting} />));
			await act(async () => root.render(<ReadingPane {...words} />));
			assert.doesNotMatch(host.textContent ?? "", /Here it is/, "the words wait");
			assert.ok(host.querySelector("[data-testid=agent-at-work]") !== null, "and the desk stays");
			await act(async () => root.render(<ReadingPane {...words} busy={false} status="ready" />));
			await act(async () => {
				await new Promise((done) => setTimeout(done, 200));
			});
			assert.match(host.textContent ?? "", /Here it is/);
			assert.ok(host.querySelector("[data-testid=stop-turn]") === null);
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});

	it("under the desk, holds a reply's first part that leaves again before its words", async () => {
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
			await act(async () => {
				await new Promise((done) => setTimeout(done, 200));
			});
			assert.match(host.textContent ?? "", /Here it is/, "the words wait, then the desk fades out");
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
			assert.ok(host.querySelector("[data-testid=agent-at-work]") !== null, "its words wait under the desk for the turn's end");
			assert.doesNotMatch(host.textContent ?? "", /Your pick holds/);
			await act(async () => root.render(<ReadingPane {...working} busy={false} status="ready" messages={[card(1), first, grown("Your pick holds. More.")]} />));
			assert.ok(host.querySelector("[data-desk-closing]") !== null, "the desk fades out");
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
