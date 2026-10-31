/**
 * The code question in the Your-turn panel and its answered card, plus the
 * unrated confidence meter (no level picked = no confidence sent).
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QuestionDock } from "../src/components/question-dock.tsx";
import { AnsweredCard } from "../src/components/answered-card.tsx";
import { buildCodeAnswer, type QuestionAnswerData } from "../src/core/index.ts";

const dom = parseHTML("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	CustomEvent: dom.window.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
});
// linkedom has no layout or selection: CodeMirror mounts here but never
// measures.
Object.assign(dom.document, { getSelection: () => null, hasFocus: () => false });
Object.assign(dom.window, {
	requestAnimationFrame: () => 0,
	cancelAnimationFrame: () => {},
	getSelection: () => null,
	MutationObserver: class {
		observe() {}
		disconnect() {}
		takeRecords() {
			return [];
		}
	},
});

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

describe("the code question panel", () => {
	it("shows the task, the editor with its language and the Vim switch (off), I don't know, thinking and Submit", () => {
		const html = renderToStaticMarkup(<QuestionDock toolName="write_code" toolCallId="c1" input={task} onSubmit={() => {}} />);
		assert.match(html, /data-testid="question-kind"[^>]*>Code</);
		assert.match(html, /<strong /, "the task renders as markdown");
		assert.match(html, /data-testid="code-language"[^>]*>C</);
		assert.match(html, /data-testid="code-editor-host"/);
		assert.match(html, /role="switch" aria-checked="false" aria-label="Vim"/);
		assert.ok(!html.includes('data-testid="vim-mode"'), "no mode label while Vim is off");
		assert.match(html, /data-testid="dont-know-option" aria-pressed="false"/);
		assert.match(html, /aria-label="Your thinking"/);
		assert.doesNotMatch(html, /data-testid="question-submit"[^>]*disabled=""/, "starter code can be submitted");
	});

	it("an empty editor waits for code", () => {
		const html = renderToStaticMarkup(<QuestionDock toolName="write_code" toolCallId="c2" input={{ question: "Write it.", language: "python" }} onSubmit={() => {}} />);
		assert.match(html, /data-testid="code-language"[^>]*>python</);
		assert.match(html, /data-testid="question-submit"[^>]*disabled=""/);
	});

	it("a malformed call shows the quiet fallback", () => {
		const html = renderToStaticMarkup(<QuestionDock toolName="write_code" toolCallId="c3" input={{ question: "" } as never} onSubmit={() => {}} />);
		assert.match(html, /data-testid="malformed-question"/);
	});

	it("restores an unconfirmed submission's code, choice and thinking", () => {
		const draft = { selection: { selected: new Set<number>(), otherSelected: false, dontKnow: true }, thinking: "kept thinking", other: "", text: "int kept;" };
		const html = renderToStaticMarkup(<QuestionDock toolName="write_code" toolCallId="c4" input={task} onSubmit={() => {}} initialDraft={draft} />);
		assert.match(html, /data-testid="dont-know-option" aria-pressed="true"/);
		assert.ok(html.includes("kept thinking"));
	});

	it("saves untouched starter code as no draft, and Skip question opens the skip", async () => {
		const saved: string[] = [];
		let skipped = 0;
		await mounted(
			<QuestionDock toolName="write_code" toolCallId="c6" input={task} onSubmit={() => {}} onSaveDraft={(d) => saved.push(d.text)} onSkip={() => skipped++} />,
			async (host) => {
				assert.deepEqual(saved, [""], "the starter code is not the learner's draft");
				await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="skip-question"]')!.click());
				assert.equal(skipped, 1);
			},
		);
	});

	it("submits the starter code, or I don't know without code, with the thinking", async () => {
		const answers: QuestionAnswerData[] = [];
		await mounted(<QuestionDock toolName="write_code" toolCallId="c5" input={task} onSubmit={(a) => answers.push(a)} />, async (host) => {
			const form = host.querySelector("form")!;
			await act(async () => form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
			assert.deepEqual(answers[0]!.code, task.starter);
			assert.equal(answers[0]!.kind, "code");
			assert.equal(answers[0]!.tool, "write_code");
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="dont-know-option"]')!.click());
			await act(async () => form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
			assert.equal(answers[1]!.dontKnow, true);
			assert.ok(!("code" in answers[1]!), "I don't know sends no code");
		});
	});
});

describe("keys typed in the editor stay in it", () => {
	it("Esc, Tab, Ctrl and single keys never reach the app's window shortcuts; ⌘ keys do", async () => {
		await mounted(<QuestionDock toolName="write_code" toolCallId="k1" input={task} onSubmit={() => {}} />, async (host) => {
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

describe("the unrated confidence meter", () => {
	const quizInput = {
		question: "Which planet is closest to the sun?",
		options: [{ label: "Venus" }, { label: "Mercury" }],
		correctAnswer: "Mercury",
		explanation: "Mercury is the innermost planet.",
	};

	it("starts with no level picked", () => {
		const html = renderToStaticMarkup(<QuestionDock toolName="quiz" toolCallId="u1" input={quizInput} onSubmit={() => {}} />);
		assert.match(html, /data-testid="confidence-value"[^>]*>How sure are you\?</);
		assert.ok(!/role="radio" aria-checked="true" aria-label="\d/.test(html), "no bar is checked");
	});

	it("an untouched meter sends no confidence; a picked level sends its percentage", async () => {
		const answers: QuestionAnswerData[] = [];
		await mounted(<QuestionDock toolName="quiz" toolCallId="u2" input={quizInput} onSubmit={(a) => answers.push(a)} />, async (host) => {
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="question-option"]')!.click());
			const form = host.querySelector("form")!;
			await act(async () => form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
			assert.ok(!("confidence" in answers[0]!), "untouched = no confidence at all");
		});
		await mounted(<QuestionDock toolName="quiz" toolCallId="u3" input={quizInput} onSubmit={(a) => answers.push(a)} />, async (host) => {
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="question-option"]')!.click());
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="confidence-level-2"]')!.click());
			const form = host.querySelector("form")!;
			await act(async () => form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
			assert.equal(answers[1]!.confidence, 40);
		});
	});

	it("an answered card without confidence shows no Sure line", () => {
		const answer: QuestionAnswerData = { kind: "quiz", questionText: "q", dontKnow: false, answers: [], correct: true, answeredAt: "" };
		const html = renderToStaticMarkup(<AnsweredCard answer={answer} />);
		assert.ok(!html.includes('data-testid="answered-confidence"'));
	});
});
