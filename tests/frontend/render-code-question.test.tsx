/**
 * The code question above the lesson box and its answered card, plus the
 * unrated confidence meter (no level picked = no confidence sent).
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { stubCodeMirrorDom } from "../math-box-dom.ts";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QuestionDock, type QuestionHandle } from "../../src/frontend/components/question-dock.tsx";
import { AnsweredCard } from "../../src/frontend/components/answered-card.tsx";
import { buildCodeAnswer, type QuestionAnswerData } from "../../src/shared/core/index.ts";

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
// linkedom has no layout: scrolling the meter into view is a no-op here.
(dom.window.Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};

const task = { question: "Write **`int max(int a, int b)`**.", starter: "int max(int a, int b) {\n}" };

async function mounted(el: React.ReactElement, run: (host: HTMLElement) => Promise<void>) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	try {
		await act(async () => root.render(el));
		await run(host);
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
}

const noop = {
	onSubmit: () => {},
	onReady: () => {},
	boxText: "",
	onLeaveRows: () => {},
};

describe("the code question", () => {
	it("shows the task, the editor with its language and the Vim switch (off) and I don't know", () => {
		const html = renderToStaticMarkup(<QuestionDock {...noop} toolName="write_code" toolCallId="c1" input={task} />);
		assert.match(html, /<strong /, "the task renders as markdown");
		assert.match(html, /data-testid="code-language"[^>]*>C</);
		assert.match(html, /data-testid="code-editor-host"/);
		assert.match(html, /role="switch" aria-checked="false" aria-label="Vim"/);
		assert.ok(!html.includes('data-testid="vim-mode"'), "no mode label while Vim is off");
		assert.match(html, /data-testid="dont-know-option" aria-pressed="false"/);
		assert.ok(!html.includes('data-testid="thinking-field"'), "the reasoning is typed in the lesson's box");
	});

	it("starter code can be submitted; an empty editor waits for code", async () => {
		const ready: boolean[] = [];
		await mounted(<QuestionDock {...noop} onReady={(r) => ready.push(r)} toolName="write_code" toolCallId="c1" input={task} />, async () => {
			assert.equal(ready.at(-1), true);
		});
		ready.length = 0;
		await mounted(<QuestionDock {...noop} onReady={(r) => ready.push(r)} toolName="write_code" toolCallId="c2" input={{ question: "Write it.", language: "python" }} />, async (host) => {
			assert.match(host.innerHTML, /data-testid="code-language"[^>]*>python</);
			assert.equal(ready.at(-1), false);
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="dont-know-option"]')!.click());
			assert.equal(ready.at(-1), true, "I don't know is an answer");
		});
	});

	it("a malformed call shows the quiet fallback", () => {
		const html = renderToStaticMarkup(<QuestionDock {...noop} toolName="write_code" toolCallId="c3" input={{ question: "" } as never} />);
		assert.match(html, /data-testid="malformed-question"/);
	});

	it("restores an unconfirmed submission's choice", () => {
		const draft = { selection: { selected: new Set<number>(), otherSelected: false, dontKnow: true }, other: "", code: "int kept;" };
		const html = renderToStaticMarkup(<QuestionDock {...noop} toolName="write_code" toolCallId="c4" input={task} initialDraft={draft} />);
		assert.match(html, /data-testid="dont-know-option" aria-pressed="true"/);
	});

	it("saves untouched starter code as no draft", async () => {
		const saved: string[] = [];
		await mounted(<QuestionDock {...noop} toolName="write_code" toolCallId="c6" input={task} onSaveDraft={(d) => saved.push(d.code ?? "")} />, async () => {
			assert.deepEqual(saved, [""], "the starter code is not the learner's draft");
		});
	});

	it("submits the starter code, or I don't know without code, with the box text as the reasoning", async () => {
		const answers: QuestionAnswerData[] = [];
		const ref = React.createRef<QuestionHandle>();
		await mounted(<QuestionDock {...noop} ref={ref} boxText="ternary" onSubmit={(a) => answers.push(a)} toolName="write_code" toolCallId="c5" input={task} />, async (host) => {
			await act(async () => ref.current!.submit());
			assert.deepEqual(answers[0]!.code, task.starter);
			assert.equal(answers[0]!.kind, "code");
			assert.equal(answers[0]!.tool, "write_code");
			assert.equal(answers[0]!.thinking, "ternary");
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="dont-know-option"]')!.click());
			await act(async () => ref.current!.submit());
			assert.equal(answers[1]!.dontKnow, true);
			assert.ok(!("code" in answers[1]!), "I don't know sends no code");
		});
	});

	it("does not submit while the teacher is busy", async () => {
		const answers: QuestionAnswerData[] = [];
		const ref = React.createRef<QuestionHandle>();
		await mounted(<QuestionDock {...noop} ref={ref} busy onSubmit={(a) => answers.push(a)} toolName="write_code" toolCallId="c7" input={task} />, async () => {
			await act(async () => ref.current!.submit());
			assert.equal(answers.length, 0);
		});
	});
});

describe("keys typed in the editor stay in it", () => {
	it("Esc, Tab, Ctrl and single keys never reach the app's window shortcuts; ⌘ keys do", async () => {
		await mounted(<QuestionDock {...noop} toolName="write_code" toolCallId="k1" input={task} />, async (host) => {
			const reached: string[] = [];
			const onKey = (e: Event) => reached.push((e as KeyboardEvent).key);
			window.addEventListener("keydown", onKey);
			try {
				const field = host.querySelector<HTMLElement>(".cm-content") ?? host.querySelector<HTMLElement>('[data-testid="code-editor-host"]')!;
				const press = (key: string, metaKey = false) => {
					const e = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
					Object.defineProperties(e, { key: { value: key }, metaKey: { value: metaKey } });
					field.dispatchEvent(e);
				};
				await act(async () => {
					for (const key of ["Escape", "Tab", "?", "d"]) press(key);
				});
				assert.deepEqual(reached, [], "the abort Esc, the field cycle and single-key shortcuts stay out");
				await act(async () => press("n", true));
				assert.deepEqual(reached, ["n"], "⌘ shortcuts still work");
			} finally {
				window.removeEventListener("keydown", onKey);
			}
		});
	});
});

describe("the answered code card", () => {
	it("shows the question and the code as a code block, no verdict", () => {
		const answer = buildCodeAnswer(task, { code: "int max(int a, int b) {\n    return a > b ? a : b;\n}", dontKnow: false, thinking: "ternary" }, "write_code");
		const html = renderToStaticMarkup(<AnsweredCard answer={answer} input={task} />);
		assert.match(html, /data-testid="answer-kind"[^>]*>Code</);
		assert.ok(!html.includes('data-testid="answer-result"'), "graded later by the teacher");
		assert.match(html, /data-testid="answered-code"/);
		assert.match(html, /data-streamdown="code-block"/, "the app's code block");
		assert.ok(html.includes("return a &gt; b ? a : b;"));
		assert.match(html, /data-testid="answer-toggle"[^>]*>Details/, "the thinking waits behind Details");
	});

	it("an I don't know answer says so and shows no code", () => {
		const answer = buildCodeAnswer(task, { code: "", dontKnow: true }, "write_code");
		const html = renderToStaticMarkup(<AnsweredCard answer={answer} input={task} />);
		assert.ok(!html.includes('data-testid="answered-code"'));
		assert.ok(html.includes("Answered “I don&#x27;t know”."));
	});
});

describe("the unrated How sure line", () => {
	const quizInput = {
		question: "Which planet is closest to the sun?",
		options: [{ label: "Venus" }, { label: "Mercury" }],
		correctAnswer: "Mercury",
		explanation: "Mercury is the innermost planet.",
	};

	it("asks nothing before a pick, then starts with no level picked", async () => {
		const html = renderToStaticMarkup(<QuestionDock {...noop} toolName="quiz" toolCallId="u1" input={quizInput} />);
		assert.doesNotMatch(html, /How sure are you/);
		await mounted(<QuestionDock {...noop} toolName="quiz" toolCallId="u1" input={quizInput} />, async (host) => {
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="question-option"]')!.click());
			assert.match(host.querySelector('[data-testid="confidence-line"]')!.textContent ?? "", /How sure are you\?/);
			assert.ok(host.querySelector('[data-testid^="confidence-level-"][aria-checked="true"]') === null, "no square is checked");
		});
	});

	it("an untouched line sends no confidence; a picked level sends its percentage", async () => {
		const answers: QuestionAnswerData[] = [];
		const ref = React.createRef<QuestionHandle>();
		await mounted(<QuestionDock {...noop} ref={ref} onSubmit={(a) => answers.push(a)} toolName="quiz" toolCallId="u2" input={quizInput} />, async (host) => {
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="question-option"]')!.click());
			await act(async () => ref.current!.submit());
			assert.ok(!("confidence" in answers[0]!), "untouched = no confidence at all");
		});
		await mounted(<QuestionDock {...noop} ref={ref} onSubmit={(a) => answers.push(a)} toolName="quiz" toolCallId="u3" input={quizInput} />, async (host) => {
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="question-option"]')!.click());
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="confidence-level-2"]')!.click());
			await act(async () => ref.current!.submit());
			assert.equal(answers[1]!.confidence, 40);
		});
	});

	it("an answered card without confidence shows no Sure line", () => {
		const answer: QuestionAnswerData = { kind: "quiz", questionText: "q", dontKnow: false, answers: [], correct: true, answeredAt: "" };
		const html = renderToStaticMarkup(<AnsweredCard answer={answer} />);
		assert.ok(!html.includes('data-testid="answered-confidence"'));
	});
});
