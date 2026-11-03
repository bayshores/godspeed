/**
 * Lesson layout B: the plan step bar, the Your-turn
 * panel's states, the question panel's keys, the practice progress, and
 * the view's message reuse.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { mathBoxView, stubCodeMirrorDom } from "./math-box-dom.ts";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { YourTurnPanel } from "../src/components/lesson/your-turn-panel.tsx";
import { StepBar, answerBlockClass, jumpTarget, rightCountLabel } from "../src/components/lesson/step-bar.tsx";
import { practiceProgress } from "../src/components/lesson/practice-progress.ts";
import { QuestionDock } from "../src/components/question-dock.tsx";
import { PracticeDock } from "../src/components/practice-dock.tsx";
import { ReadingPane } from "../src/components/lesson/reading-pane.tsx";
import { CONFIDENCE_STOPS, projectView, reuseUnchangedMessages, type LhMessage, type PlanStepBar, type QuestionAnswerData, type QuestionFormDraft } from "../src/core/index.ts";

const dom = parseHTML("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	CustomEvent: dom.window.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
});
stubCodeMirrorDom(dom);
// linkedom has no layout: the walked row's scrollIntoView is a no-op here.
(dom.window.Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};

const quizInput = {
	question: "Which planet is closest to the sun?",
	options: [{ label: "Venus" }, { label: "Mercury" }, { label: "Mars" }],
	correctAnswer: "Mercury",
	explanation: "Mercury is the innermost planet.",
};

const composer = (over: Partial<React.ComponentProps<typeof YourTurnPanel>["composer"]> = {}) => ({
	busy: false,
	value: "",
	onChange: () => {},
	onSend: () => {},
	onStop: () => {},
	canSend: false,
	queuedSteers: [],
	attachments: { files: [], error: null, add: () => {}, remove: () => {}, clear: () => {}, restore: () => {} },
	...over,
});

function panel(over: Partial<React.ComponentProps<typeof YourTurnPanel>> = {}) {
	return renderToStaticMarkup(
		<YourTurnPanel
			pending={null}
			requiresReveal={false}
			onSaveQuestionDraft={() => {}}
			onSubmitAnswer={() => {}}
			onSkipQuestion={() => {}}
			readingThinking=""
			onReadingThinking={() => {}}
			practice={null}
			practiceNumber={null}
			onSavePracticeDraft={() => {}}
			onSubmitThinking={async () => true}
			onDiscardProblem={() => {}}
						sideReply={false}
			compacting={false}
			composer={composer()}
			stats={null}
			{...over}
		/>,
	);
}

describe("the Your-turn panel's states", () => {
	it("no question waiting: the message box with Send", () => {
		const html = panel();
		assert.match(html, /data-mode="chat"/);
		assert.match(html, /data-testid="panel-eyebrow"[^>]*>Your turn</);
		assert.match(html, /placeholder="Message the teacher…"/);
		assert.match(html, /data-testid="composer-send"[^>]*disabled[\s\S]*?>Send</, "Send waits for text");
		assert.ok(!html.includes("stop-turn"), "no Stop while idle");
	});

	it("while the teacher writes: Stop and the gray Send when ready (no line repeating it)", () => {
		const html = panel({ composer: composer({ busy: true, value: "wait, why?", canSend: true }) });
		assert.match(html, /Teacher is writing…/);
		assert.match(html, /data-testid="stop-turn"[\s\S]*?Stop<\/button>/, "no key hint beside Stop");
		assert.ok(!html.includes("Sends when the teacher finishes"));
		assert.match(html, /data-testid="composer-send"[^>]*class="[^"]*bg-tone-2[\s\S]*?Send when ready/);
	});

	it("queued messages and the notice slot sit in the panel", () => {
		const html = panel({
			composer: composer({ busy: true, queuedSteers: [{ id: "s1", text: "and the variance?" }], notice: <p data-testid="composer-notice">Waiting for your agent</p> }),
		});
		assert.match(html, /data-testid="queued-steers"[\s\S]*?and the variance\?/);
		assert.match(html, /data-testid="composer-notice"/);
	});

	it("a practice pause turns the bar into Next problem", () => {
		const html = panel({ composer: composer({ nextProblem: true }) });
		assert.match(html, /data-testid="next-problem-button"[\s\S]*?Next problem/);
	});

	it("a waiting question fills the panel", () => {
		const html = panel({ pending: { tool: "quiz", toolCallId: "q1", input: quizInput } });
		assert.match(html, /data-mode="question"/);
		assert.match(html, /data-testid="question-dock"/);
		assert.match(html, /Which planet is closest/);
		assert.match(html, /Submit answer/);
	});

	it("a teach-phase check waits behind Check your understanding, with the reading field", () => {
		const html = panel({ pending: { tool: "quiz", toolCallId: "t1", input: { ...quizInput, type: "check" } }, requiresReveal: true });
		assert.match(html, /data-mode="reveal"/);
		assert.match(html, /data-testid="teach-check-reveal"[\s\S]*?Check your understanding/);
		assert.match(html, /data-testid="reading-thinking-field"/);
		assert.ok(!html.includes("Which planet is closest"), "the question stays hidden until opened");
		assert.ok(!html.includes('data-testid="question-dock"'));
	});

	it("an active practice problem fills the panel with its number", () => {
		const html = panel({ practice: { toolCallId: "p1", input: { statement: "Find E[N]." } }, practiceNumber: 3 });
		assert.match(html, /data-mode="practice"/);
		assert.match(html, /Problem 3/);
		assert.match(html, /Find E\[N\]\./);
	});

	it("mouse-first: no action bar shows a key label", () => {
		for (const html of [
			panel({ composer: composer({ canSend: true, value: "hi" }) }),
			panel({ pending: { tool: "quiz", toolCallId: "q1", input: quizInput } }),
			panel({ practice: { toolCallId: "p1", input: { statement: "Find E[N]." } }, practiceNumber: 1 }),
		]) {
			assert.ok(!html.includes("Enter"), "no Enter label");
		}
	});

	it("a waiting question, a check behind its reveal and a code question each show Skip question", () => {
		const skip = /data-testid="skip-question"[^>]*>Skip question</;
		assert.match(panel({ pending: { tool: "quiz", toolCallId: "q1", input: quizInput } }), skip);
		assert.match(panel({ pending: { tool: "quiz", toolCallId: "t1", input: { ...quizInput, type: "check" } }, requiresReveal: true }), skip);
		assert.match(panel({ pending: { tool: "write_code", toolCallId: "w1", input: { question: "Write add.", language: "python" } } }), skip);
	});

	it("an active problem shows Discard problem", () => {
		const html = panel({ practice: { toolCallId: "p1", input: { statement: "Find E[N]." } }, practiceNumber: 2 });
		assert.match(html, /data-testid="discard-problem"[^>]*>Discard problem</);
	});

	it("Skip question and Discard problem open their confirms", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		const asked: string[] = [];
		const render = (over: Partial<React.ComponentProps<typeof YourTurnPanel>>) => (
			<YourTurnPanel
				pending={null}
				requiresReveal={false}
				onSaveQuestionDraft={() => {}}
				onSubmitAnswer={() => {}}
				onSkipQuestion={() => asked.push("question")}
				readingThinking=""
				onReadingThinking={() => {}}
				practice={null}
				practiceNumber={null}
				onSavePracticeDraft={() => {}}
				onSubmitThinking={async () => true}
				onDiscardProblem={() => asked.push("problem")}
								sideReply={false}
				compacting={false}
				composer={composer()}
				stats={null}
				{...over}
			/>
		);
		try {
			await act(async () => root.render(render({ pending: { tool: "quiz", toolCallId: "q1", input: quizInput } })));
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="skip-question"]')!.click());
			await act(async () => root.render(render({ practice: { toolCallId: "p1", input: { statement: "Find E[N]." } } })));
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="discard-problem"]')!.click());
			assert.deepEqual(asked, ["question", "problem"]);
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});

	it("while the turn waits for an agent the header says so instead of Teacher is writing", () => {
		const html = panel({ composer: composer({ busy: true, waitingForAgent: true }) });
		assert.match(html, /data-testid="panel-eyebrow"[^>]*>Waiting for your agent</);
		assert.ok(!html.includes("Teacher is writing"));
		assert.match(html, /data-testid="stop-turn"/, "Stop stays");
	});
});

describe("the side question box", () => {
	const waiting = { pending: { tool: "quiz", toolCallId: "q1", input: quizInput } };
	const box = /data-testid="side-question"/;

	it("sits under a waiting question and under a check behind its reveal, never with the message box", () => {
		const question = panel(waiting);
		assert.match(question, /Submit answer[\s\S]*data-testid="side-question"/, "below Submit answer");
		assert.match(panel({ ...waiting, requiresReveal: true }), /Check your understanding[\s\S]*data-testid="side-question"/);
		assert.match(panel({ pending: { tool: "write_code", toolCallId: "w1", input: { question: "Write add.", language: "python" } } }), box);
		assert.ok(!box.test(panel()));
	});

	describe("under an active problem", () => {
		const problem = { practice: { toolCallId: "p1", input: { statement: "Find E[N]." } }, practiceNumber: 1 };

		it("sits under the practice dock's Your thinking and Send, behind the same link", () => {
			const html = panel(problem);
			assert.match(html, /Your thinking[\s\S]*data-testid="practice-send"[\s\S]*data-testid="side-question"/);
			const side = html.slice(html.indexOf('data-testid="side-question"'));
			assert.match(side, /data-testid="side-question-open"[^>]*>.*Ask a side question</);
			assert.ok(!side.includes("<textarea"));
		});

		it("while the teacher replies to it, the box holds Stop, the only one", () => {
			const html = panel({ ...problem, sideReply: true, composer: composer({ busy: true, value: "why?" }) });
			assert.match(html, /data-testid="practice-send"[^>]*disabled=""/, "the thinking waits");
			assert.match(html, /<textarea[^>]*disabled=""[^>]*placeholder="Ask the teacher something"/);
			assert.equal(html.split('data-testid="stop-turn"').length - 1, 1);
			assert.match(html.slice(html.indexOf('data-testid="side-question"')), /data-testid="stop-turn"/);
		});

		it("while the teacher replies to the thinking or a turn the app started, Stop stays in the dock and the box stays behind its link", () => {
			const html = panel({ ...problem, composer: composer({ busy: true }) });
			assert.equal(html.split('data-testid="stop-turn"').length - 1, 1);
			const side = html.slice(html.indexOf('data-testid="side-question"'));
			assert.match(side, /data-testid="side-question-open"/);
			assert.ok(!side.includes('data-testid="stop-turn"'));
		});
	});

	it("waits behind an Ask a side question link, with no em-dash or key hint", () => {
		const html = panel(waiting);
		const side = html.slice(html.indexOf('data-testid="side-question"'));
		assert.match(side, /data-testid="side-question-open"[^>]*>.*Ask a side question</);
		assert.ok(!side.includes("<textarea"), "no field until it is asked for");
		assert.ok(!side.includes("—") && !side.includes("Enter"));
	});

	it("stays open while there is a draft, and names itself once, as its placeholder", () => {
		const html = panel({ ...waiting, composer: composer({ value: "why 13?" }) });
		assert.equal(html.split("Ask the teacher something").length - 1, 2, "the placeholder and its accessible name");
		assert.match(html, /placeholder="Ask the teacher something"/);
		assert.ok(!html.includes('data-testid="side-question-open"'));
	});

	it("takes pictures and PDFs like the message box: the same button beside the field, the tray above it", () => {
		const files = {
			files: [
				{ id: "f1", attachment: { name: "graph.png", mimeType: "image/png", data: "iVBORw0KGgo=" } },
				{ id: "f2", attachment: { name: "notes.pdf", mimeType: "application/pdf", data: "JVBERi0=" } },
			],
			error: null,
			add: () => {},
			remove: () => {},
			clear: () => {},
			restore: () => {},
		};
		const html = panel({ ...waiting, composer: composer({ attachments: files, canSend: true }) });
		const side = html.slice(html.indexOf('data-testid="side-question"'));
		assert.ok(!side.includes('data-testid="side-question-open"'), "waiting files keep it open");
		assert.match(side, /data-testid="attachment-tray"[\s\S]*data-testid="draft-image"[\s\S]*data-testid="draft-pdf"[\s\S]*<textarea/);
		assert.match(side, /data-testid="attach-button"[\s\S]*<textarea[\s\S]*data-testid="side-question-send"/);
		assert.match(side, /type="file"[^>]*accept="image\/png,image\/jpeg,image\/gif,image\/webp,application\/pdf"/);
		assert.doesNotMatch(side, /data-testid="side-question-send"[^>]*disabled=""/, "files alone can be sent");
		const refused = panel({ ...waiting, composer: composer({ attachments: { ...files, files: [], error: "You can add up to 5 files to one message." } }) });
		assert.match(refused.slice(refused.indexOf('data-testid="side-question"')), /data-testid="attachment-error"[^>]*>You can add up to 5 files to one message\.</);
	});

	it("while the teacher replies, the box and Submit answer wait, the header says so and Stop takes Send's place", () => {
		const picked: QuestionFormDraft = { selection: { selected: new Set([0]), otherSelected: false, dontKnow: false }, thinking: "", other: "", text: "" };
		const submit = /data-testid="question-submit"[^>]*disabled=""/;
		assert.ok(!submit.test(panel({ ...waiting, initialQuestionDraft: picked })), "an answer is ready to submit");
		const html = panel({ ...waiting, initialQuestionDraft: picked, sideReply: true, composer: composer({ busy: true, value: "why?" }) });
		assert.match(html, submit);
		assert.match(html, /<textarea[^>]*disabled=""[^>]*placeholder="Ask the teacher something"/);
		assert.match(html, /data-testid="panel-eyebrow"[^>]*>Teacher is writing…</);
		const side = html.slice(html.indexOf('data-testid="side-question"'));
		assert.match(side, /data-testid="stop-turn"/);
		assert.ok(!side.includes('data-testid="side-question-send"'));
		const waitingForAgent = panel({ ...waiting, requiresReveal: true, composer: composer({ busy: true, waitingForAgent: true }) });
		assert.match(waitingForAgent, /data-testid="panel-eyebrow"[^>]*>Waiting for your agent</, "the check behind its reveal too");
	});

	it("Stop ends the side reply alone, with no skip", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		const calls: string[] = [];
		try {
			await act(async () =>
				root.render(
					<YourTurnPanel
						pending={waiting.pending}
						requiresReveal={false}
						onSaveQuestionDraft={() => {}}
						onSubmitAnswer={() => {}}
						onSkipQuestion={() => calls.push("skip")}
						readingThinking=""
						onReadingThinking={() => {}}
						practice={null}
						practiceNumber={null}
						onSavePracticeDraft={() => {}}
						onSubmitThinking={async () => true}
						onDiscardProblem={() => {}}
												sideReply
						compacting={false}
						composer={composer({ busy: true, onStop: () => calls.push("stop") })}
						stats={null}
					/>,
				),
			);
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="stop-turn"]')!.click());
			assert.deepEqual(calls, ["stop"]);
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});

	it("the link opens the field focused; leaving it empty closes it, sending closes it", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		const render = (value: string, onSend = () => {}) => (
			<YourTurnPanel
				pending={waiting.pending}
				requiresReveal={false}
				onSaveQuestionDraft={() => {}}
				onSubmitAnswer={() => {}}
				onSkipQuestion={() => {}}
				readingThinking=""
				onReadingThinking={() => {}}
				practice={null}
				practiceNumber={null}
				onSavePracticeDraft={() => {}}
				onSubmitThinking={async () => true}
				onDiscardProblem={() => {}}
								sideReply={false}
				compacting={false}
				composer={composer({ value, canSend: value.trim() !== "", onSend })}
				stats={null}
			/>
		);
		const field = () => host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask the teacher something"]');
		// linkedom has no activeElement: record focus() calls instead.
		const proto = dom.window.HTMLElement.prototype as { focus: () => void };
		const realFocus = proto.focus;
		const focused: unknown[] = [];
		proto.focus = function (this: unknown) {
			focused.push(this);
		};
		try {
			await act(async () => root.render(render("")));
			assert.equal(field(), null);
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="side-question-open"]')!.click());
			assert.ok(field(), "open");
			assert.ok(focused.includes(field()), "focused, ready to type");
			await act(async () => field()!.dispatchEvent(new dom.window.Event("focusout", { bubbles: true })));
			assert.equal(field(), null, "left empty, it closes");
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="side-question-open"]')!.click());
			// The parent clears the draft once it is sent.
			await act(async () => root.render(render("why 13?", () => root.render(render("")))));
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="side-question-send"]')!.click());
			assert.equal(field(), null, "sent, it closes");
		} finally {
			proto.focus = realFocus;
			await act(async () => root.unmount());
			host.remove();
		}
	});

	it("Send asks the side question, and only when there is something to send", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		let sent = 0;
		const render = (canSend: boolean) => (
			<YourTurnPanel
				pending={waiting.pending}
				requiresReveal={false}
				onSaveQuestionDraft={() => {}}
				onSubmitAnswer={() => {}}
				onSkipQuestion={() => {}}
				readingThinking=""
				onReadingThinking={() => {}}
				practice={null}
				practiceNumber={null}
				onSavePracticeDraft={() => {}}
				onSubmitThinking={async () => true}
				onDiscardProblem={() => {}}
								sideReply={false}
				compacting={false}
				composer={composer({ value: canSend ? "why?" : " ", canSend, onSend: () => sent++ })}
				stats={null}
			/>
		);
		try {
			await act(async () => root.render(render(false)));
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="side-question-open"]')!.click());
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="side-question-send"]')!.click());
			assert.equal(sent, 0);
			await act(async () => root.render(render(true)));
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="side-question-send"]')!.click());
			assert.equal(sent, 1);
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});
});

describe("saved drafts in the panel", () => {
	it("a practice problem starts from its saved thinking", () => {
		const html = renderToStaticMarkup(<PracticeDock problemCallId="p1" input={{ statement: "Find E[N]." }} onSubmit={async () => true} initialDraft="half done" />);
		assert.match(html, /data-testid="math-box"[^]*>half done</);
	});

	it("a practice send clears the saved draft, and a refused one puts it back", async () => {
		for (const taken of [true, false]) {
			const host = document.createElement("div");
			document.body.append(host);
			const root = createRoot(host);
			const saved: string[] = [];
			try {
				await act(async () =>
					root.render(
						<PracticeDock problemCallId="p1" input={{ statement: "Find E[N]." }} onSubmit={async () => taken} initialDraft="half done" onSaveDraft={(t) => saved.push(t)} />,
					),
				);
				await act(async () => press("Enter"));
				assert.deepEqual(saved, taken ? [""] : ["", "half done"]);
			} finally {
				await act(async () => root.unmount());
				host.remove();
			}
		}
	});

	it("a question form starts from the saved draft and saves every change", async () => {
		const draft: QuestionFormDraft = { selection: { selected: new Set([0]), otherSelected: false, dontKnow: false }, thinking: "because", other: "", text: "" };
		assert.match(
			renderToStaticMarkup(<QuestionDock toolName="quiz" toolCallId="q1" input={quizInput} onSubmit={() => {}} initialDraft={draft} />),
			/data-testid="math-box"[^]*>because</,
		);
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		const saved: QuestionFormDraft[] = [];
		try {
			await act(async () =>
				root.render(<QuestionDock toolName="quiz" toolCallId="q1" input={quizInput} onSubmit={() => {}} initialDraft={draft} onSaveDraft={(d) => saved.push(d)} />),
			);
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="dont-know-option"]')!.click());
			assert.equal(saved.at(-1)!.selection.dontKnow, true);
			assert.equal(saved.at(-1)!.thinking, "because");
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});
});

describe("the reading pane's waiting and error states", () => {
	const pane = (over: Partial<React.ComponentProps<typeof ReadingPane>> = {}) =>
		renderToStaticMarkup(
			<ReadingPane
				messages={[]}
				phases={[]}
				status="submitted"
				busy
				turnInFlight={false}
				compacting={false}
				waitingForAgent={false}
				error={null}
				onRetry={() => {}}
				arrivalsLive={false}
				arrive={() => undefined}
				onOpenPlan={() => {}}
				scrollContextRef={{ current: null }}
				{...over}
			/>,
		);

	it("Thinking… while the agent works", () => {
		const html = pane();
		assert.match(html, /Thinking…/);
		assert.ok(!html.includes("lesson-waiting"));
	});

	it("one waiting state, with how to connect and the Connection settings button, while no agent takes the turn", () => {
		const html = pane({ waitingForAgent: true });
		assert.ok(!html.includes("Thinking…"), "no shimmer while nothing works");
		assert.match(html, /data-testid="lesson-waiting"[^>]*>Waiting for your agent</);
		assert.match(html, /Open your agent from the sidebar\./);
		assert.match(html, /data-testid="lesson-waiting-settings"[^>]*>Open Connection settings</);
	});

	it("an error reads as a plain sentence with Try again; the raw text is the hover tip", () => {
		const html = pane({ busy: false, status: "error", error: { message: "The send failed (500)." } });
		assert.match(html, /data-testid="lesson-error" title="The send failed \(500\)\.">Your message didn&#x27;t go through\.</);
		assert.match(html, /data-testid="lesson-error-retry"[^>]*>Try again</);
		assert.ok(!html.includes("Something went wrong"));
	});

	it("an empty lesson says it is new, with no promise of a probe", () => {
		const html = pane({ busy: false, status: "ready" });
		assert.match(html, />New lesson</);
		assert.doesNotMatch(html, /see what you already know/);
	});
});

// ─── the plan step bar ───────────────────────────────────────────────────────

const bar: PlanStepBar = {
	currentIndex: 1,
	steps: [
		{ id: "a", title: "The update rule", status: "visited", answers: [{ toolCallId: "c1", outcome: "right" }, { toolCallId: "c2", outcome: "wrong", level: 4 }] },
		{ id: "b", title: "Gradient as an expectation", status: "current", answers: [] },
		{ id: "c", title: "Variance", status: "upcoming", answers: [] },
	],
};

describe("the plan step bar", () => {
	it("one block per step, the count and the current step's name", () => {
		const html = renderToStaticMarkup(<StepBar bar={bar} onJump={() => {}} onOpenPlan={() => {}} />);
		const statuses = [...html.matchAll(/data-testid="plan-step" data-status="(\w+)"/g)].map((m) => m[1]);
		assert.deepEqual(statuses, ["visited", "current", "upcoming"]);
		assert.match(html, /data-testid="plan-step-count"[^>]*>2 \/ 3</);
		assert.match(html, /Gradient as an expectation/);
		assert.match(html, /data-testid="plan-step-open"/, "the chevron opens the plan map");
		// The current step is the wide white block.
		assert.match(html, /data-status="current"[\s\S]*?w-\[22px\] bg-ink/);
	});

	it("tooltip data: answers as colored blocks and 'n of m right'", () => {
		assert.equal(rightCountLabel(bar.steps[0]!.answers), "1 of 2 right");
		assert.equal(rightCountLabel([]), null);
		assert.equal(rightCountLabel([{ toolCallId: "e", outcome: "ungraded" }]), null, "explain answers are not graded");
		assert.equal(answerBlockClass({ toolCallId: "x", outcome: "right" }), "bg-ans-right");
		assert.equal(answerBlockClass({ toolCallId: "x", outcome: "dontKnow" }), "bg-ans-dontknow");
	});

	it("only a done step with an answer jumps back", () => {
		assert.equal(jumpTarget(bar.steps[0]!), "c1");
		assert.equal(jumpTarget(bar.steps[1]!), null, "the current step does not jump");
		assert.equal(jumpTarget({ ...bar.steps[0]!, answers: [] }), null);
	});

	it("clicking a done step calls the jump with its first answer", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		const jumps: string[] = [];
		try {
			await act(async () => root.render(<StepBar bar={bar} onJump={(id) => jumps.push(id)} onOpenPlan={() => {}} />));
			const steps = host.querySelectorAll<HTMLButtonElement>('[data-testid="plan-step"]');
			await act(async () => steps[0]!.click());
			await act(async () => steps[2]!.click());
			assert.deepEqual(jumps, ["c1"], "done step jumps; upcoming does nothing");
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});
});

// ─── the question panel's keys ───────────────────────────────────────────────

function press(key: string) {
	const e = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
	Object.defineProperty(e, "key", { value: key });
	document.dispatchEvent(e);
}

describe("the question panel's keys", () => {
	it("number keys pick options, 0 is I don't know, ←/→ move confidence, Enter submits", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		let answer: QuestionAnswerData | undefined;
		try {
			await act(async () => root.render(<QuestionDock toolName="quiz" toolCallId="keys1" input={quizInput} onSubmit={(a) => (answer = a)} />));
			const rows = () => [...host.querySelectorAll<HTMLButtonElement>('[data-testid="question-option"]')];
			await act(async () => press("2"));
			assert.equal(rows()[1]!.getAttribute("aria-checked"), "true", "2 picks the second row");
			await act(async () => press("0"));
			assert.equal(host.querySelector('[data-testid="dont-know-option"]')!.getAttribute("aria-pressed"), "true", "0 = I don't know");
			assert.ok(rows().every((r) => r.getAttribute("aria-checked") === "false"), "I don't know clears the pick");
			await act(async () => press("1"));
			assert.equal(rows()[0]!.getAttribute("aria-checked"), "true");
			await act(async () => press("9"));
			assert.equal(rows()[0]!.getAttribute("aria-checked"), "true", "a key past the options does nothing");
			await act(async () => press("ArrowRight"));
			assert.match(host.querySelector('[data-testid="confidence-value"]')!.textContent ?? "", /^4 · Fairly sure$/);
			await act(async () => press("Enter"));
			assert.ok(answer, "Enter submits");
			assert.equal(answer!.confidence, CONFIDENCE_STOPS[3], "level 4 is saved as 80%");
			assert.equal(answer!.answers[0]!.label, rows()[0]!.textContent?.replace(/^1/, ""));
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});

	it("clicking a confidence bar sets the level", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		try {
			await act(async () => root.render(<QuestionDock toolName="quiz" toolCallId="keys2" input={quizInput} onSubmit={() => {}} />));
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="confidence-level-5"]')!.click());
			assert.equal(host.querySelector('[data-testid="confidence-value"]')!.textContent, "5 · Certain");
			assert.equal(host.querySelector('[data-testid="confidence-level-5"]')!.getAttribute("aria-checked"), "true");
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});
});

describe("writing folds the answer list", () => {
	async function dock(run: (host: HTMLElement) => Promise<void>) {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		try {
			await act(async () => root.render(<QuestionDock toolName="quiz" toolCallId="fold1" input={quizInput} onSubmit={() => {}} />));
			await run(host);
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	}
	const focusThinking = async (host: HTMLElement) => {
		const content = (await mathBoxView(host, "Your thinking")).contentDOM;
		await act(async () => content.dispatchEvent(new dom.window.Event("focusin", { bubbles: true })));
	};

	it("clicking into the box with an answer picked folds the list and Sure meter into one row; Change opens them", async () => {
		await dock(async (host) => {
			const mercury = [...host.querySelectorAll<HTMLButtonElement>('[data-testid="question-option"]')].find((b) => b.textContent?.includes("Mercury"))!;
			await act(async () => mercury.click());
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="confidence-level-4"]')!.click());
			await focusThinking(host);
			const row = host.querySelector<HTMLElement>('[data-testid="picked-row"]')!;
			assert.match(row.textContent ?? "", /Mercury/);
			assert.equal(row.querySelector('[data-testid="confidence-square-4"]')!.getAttribute("aria-checked"), "true", "Sure 4 rides the row");
			assert.equal(host.querySelectorAll('[data-testid="question-option"]').length, 0, "the list is folded");
			assert.equal(host.querySelector('[data-testid="confidence-level-4"]'), null, "the Sure meter is folded");
			await act(async () => row.querySelector<HTMLButtonElement>('[data-testid="picked-change"]')!.click());
			assert.equal(host.querySelector('[data-testid="picked-row"]'), null);
			assert.equal(host.querySelectorAll('[data-testid="question-option"]').length, 3);
			assert.equal(host.querySelector('[data-testid="confidence-level-4"]')!.getAttribute("aria-checked"), "true", "the meter comes back as set");
		});
	});

	it("unrated when it folds, the row asks how sure; a square sets it and goes with the answer", async () => {
		let sent: QuestionAnswerData | null = null;
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		try {
			await act(async () => root.render(<QuestionDock toolName="quiz" toolCallId="fold2" input={quizInput} onSubmit={(a) => (sent = a)} />));
			const mercury = [...host.querySelectorAll<HTMLButtonElement>('[data-testid="question-option"]')].find((b) => b.textContent?.includes("Mercury"))!;
			await act(async () => mercury.click());
			await focusThinking(host);
			const squares = [...host.querySelectorAll<HTMLButtonElement>('[data-testid^="confidence-square-"]')];
			assert.equal(squares.length, 5);
			assert.ok(squares.every((s) => s.getAttribute("aria-checked") === "false"), "nothing picked yet, all dark");
			await act(async () => squares[2]!.click());
			assert.equal(host.querySelector('[data-testid="confidence-square-3"]')!.getAttribute("aria-checked"), "true");
			const form = host.querySelector('[data-testid="question-dock"]')!;
			await act(async () => form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
			assert.equal(sent!.confidence, CONFIDENCE_STOPS[2]);
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});

	it("I don't know folds without a Sure row", async () => {
		await dock(async (host) => {
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="dont-know-option"]')!.click());
			await focusThinking(host);
			assert.match(host.querySelector('[data-testid="picked-row"]')!.textContent ?? "", /I don't know/);
			assert.equal(host.querySelector('[data-testid="confidence-squares"]'), null);
		});
	});

	it("with nothing picked the list stays open", async () => {
		await dock(async (host) => {
			await focusThinking(host);
			assert.equal(host.querySelector('[data-testid="picked-row"]'), null);
			assert.equal(host.querySelectorAll('[data-testid="question-option"]').length, 3);
		});
	});
});

// ─── practice progress ───────────────────────────────────────────────────────

describe("practiceProgress", () => {
	const msg = (...parts: Array<{ type: string; state?: string; input?: unknown }>) => ({ parts });
	it("counts finished problems, solved ones, and the active one", () => {
		const messages = [
			msg({ type: "tool-problem", state: "input-available" }, { type: "tool-conclude", state: "output-available", input: { outcome: "solved" } }),
			msg({ type: "tool-problem", state: "input-available" }, { type: "tool-conclude", state: "output-available", input: { outcome: "surrendered" } }),
			msg({ type: "tool-problem", state: "input-available" }, { type: "tool-conclude", state: "output-available", input: { outcome: "solvedWithHints" } }),
			msg({ type: "tool-problem", state: "input-available" }),
		];
		const p = practiceProgress(messages, true);
		assert.deepEqual(p.blocks, ["solved", "missed", "solved", "current"]);
		assert.equal(p.solved, 2);
		assert.equal(p.finished, 3);
		assert.equal(p.currentNumber, 4);
	});

	it("errored calls never count; no active problem means no current block", () => {
		const p = practiceProgress([msg({ type: "tool-problem", state: "output-error" }), msg({ type: "tool-conclude", input: { outcome: "solved" } })], false);
		assert.deepEqual(p.blocks, []);
		assert.equal(p.currentNumber, null);
	});
});

// ─── message reuse (only the streaming row redraws) ──────────────────────────

describe("reuseUnchangedMessages", () => {
	const usage = { input: 0, output: 0, total: 0, cacheReads: 0, cacheWrites: 0 };
	const a = (id: string, text: string) =>
		({ id, role: "assistant", content: [{ type: "text", text }], stopReason: "stop", usage, provider: "x", model: "x", timestamp: 0 }) as unknown as LhMessage;
	const u = (id: string, text: string) => ({ id, role: "user", content: text, timestamp: 0 }) as unknown as LhMessage;

	it("keeps unchanged message objects and replaces only the changed one", () => {
		const record = [u("u1", "hi"), a("a1", "first"), u("u2", "more"), a("a2", "stream")];
		const prev = projectView(record);
		const next = projectView([...record.slice(0, 3), a("a2", "streaming more")]);
		const out = reuseUnchangedMessages(prev, next);
		assert.equal(out[0], prev[0]);
		assert.equal(out[1], prev[1]);
		assert.equal(out[2], prev[2]);
		assert.notEqual(out[3], prev[3]);
		assert.equal(out[3]!.parts.at(-1)!.text, "streaming more");
	});

	it("returns the previous list itself when nothing changed", () => {
		const record = [u("u1", "hi"), a("a1", "first")];
		const prev = projectView(record);
		assert.equal(reuseUnchangedMessages(prev, projectView(record)), prev);
	});

	it("a message that gains a part is new; an appended message keeps the rest", () => {
		const prev = projectView([u("u1", "hi"), a("a1", "first")]);
		const next = projectView([u("u1", "hi"), a("a1", "first"), a("a2", "second")]);
		const out = reuseUnchangedMessages(prev, next);
		assert.equal(out[0], prev[0]);
		assert.notEqual(out[1], prev[1], "a2 joined a1's group: the group changed");
		assert.equal(out.length, 2);
	});
});
