import React, { act } from "react";
(globalThis as { React?: typeof React }).React = React;
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { stubCodeMirrorDom } from "../math-box-dom.ts";
import { QuestionDock, type QuestionHandle } from "../../src/frontend/components/question-dock.tsx";
import { AnsweredCard } from "../../src/frontend/components/answered-card.tsx";
import { newAnswerResult, type QuestionAnswerData } from "../../src/shared/core/index.ts";

const noop = { onSubmit: () => {}, onReady: () => {}, boxText: "", onLeaveRows: () => {} };

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
stubCodeMirrorDom(dom);
// linkedom has no layout: scrolling the meter into view is a no-op here.
(dom.window.Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};

test("actual select → submit → saved result → historical Why uses source data and presentation-only recovery", async () => {
	const question = String.raw`Find $\\nabla f$ for $\begin{pmatrix}a&b\\c&d\end{pmatrix}$.`;
	const label = String.raw`$\\nabla f$`;
	const explanation = String.raw`First paragraph.\n\nThe matrix is $\begin{pmatrix}p&q\\r&s\end{pmatrix}$ and $\\nabla f$ is its gradient.`;
	const input = { question, options: [{ label }, { label: "no" }], correctAnswer: label, explanation };
	const before = structuredClone(input);
	let answer: QuestionAnswerData | undefined;
	const ref = React.createRef<QuestionHandle>();
	const host = document.createElement("div"); document.body.append(host);
	const root = createRoot(host);
	try {
		await act(async () => root.render(<QuestionDock {...noop} ref={ref} toolName="probe" toolCallId="interactive_source" input={input} onSubmit={(a) => { answer = a; }} />));
		assert.equal(host.querySelectorAll("mtr").length, 2, "the live matrix retains two rows");
		const choice = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(button => button.querySelector(".katex"))!;
		assert.ok(choice);
		await act(async () => choice.click());
		assert.equal(choice.getAttribute("aria-checked"), "true");
		await act(async () => ref.current!.submit());
		assert.ok(answer);
		assert.equal(answer.questionText, question);
		assert.equal(answer.explanation, explanation);
		assert.equal(answer.answers[0]!.value, label, "display recovery must not alter the submitted identity");
		assert.equal(answer.answers[0]!.label, label);
		assert.equal(answer.correct, true);
		const persisted = JSON.parse(JSON.stringify(newAnswerResult("interactive_source", "probe", answer)));
		assert.deepEqual(persisted.details, JSON.parse(JSON.stringify(answer)));
		assert.equal(persisted.details.explanation, explanation);
		const saved = structuredClone(persisted.details);
		await act(async () => root.render(<AnsweredCard answer={persisted.details} input={input} />));
		const why = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.startsWith("Why"))!;
		await act(async () => why.click());
		assert.equal(host.querySelectorAll("mtr").length, 4, "question and revealed explanation retain their rows");
		const paragraphs = host.querySelectorAll('[data-testid="tucked-explanation"] p');
		assert.equal(paragraphs.length, 2, "recovered paragraphs remain distinct in Why");
		assert.ok(!paragraphs[0]!.parentElement!.classList.contains("[&_p]:inline"));
		const annotations = [...host.querySelectorAll('annotation[encoding="application/x-tex"]')].map(n => n.textContent);
		assert.equal(annotations.filter(t => t === String.raw`\nabla f`).length, 3);
		assert.deepEqual(persisted.details, saved);
		assert.deepEqual(input, before);
	} finally { await act(async () => root.unmount()); host.remove(); }
});

test("committed-answer reveals keep the first paragraph inline without flattening later paragraphs", async () => {
	const committed = String.raw`First paragraph.\n\nSecond paragraph with $\\nabla f$ and $\nu$.`;
	const answer: QuestionAnswerData = { kind: "explain", questionText: "Explain the gradient.", answers: [], text: "Synthetic answer", committed, dontKnow: false, answeredAt: "2026-10-26T00:00:00.000Z" };
	const input = { question: answer.questionText, correctAnswer: committed };
	const before = structuredClone(answer);
	const host = document.createElement("div"); document.body.append(host);
	const root = createRoot(host);
	try {
		await act(async () => root.render(<AnsweredCard answer={answer} input={input} defaultOpen />));
		const paragraphs = host.querySelectorAll("p");
		assert.equal(paragraphs.length, 3, "question plus two committed-answer paragraphs");
		assert.ok(paragraphs[1]!.parentElement!.classList.contains("[&>p:first-child]:inline"));
		assert.ok(!paragraphs[1]!.parentElement!.classList.contains("[&_p]:inline"));
		assert.equal(host.querySelectorAll(".katex-error").length, 0);
		assert.deepEqual(answer, before);
	} finally { await act(async () => root.unmount()); host.remove(); }
});

test("Tab from a quiz row goes to the lesson's box; Tab from the box moves on as usual", async () => {
	const input = { question: "Which planet is closest to the sun?", options: [{ label: "Venus" }, { label: "Mercury" }], correctAnswer: "Mercury", explanation: "Mercury is the innermost planet." };
	const host = document.createElement("div"); document.body.append(host);
	const box = document.createElement("textarea"); document.body.append(box);
	const root = createRoot(host);
	let left = 0;
	const tab = (target: Element) => {
		const e = new window.Event("keydown", { bubbles: true, cancelable: true });
		Object.defineProperty(e, "key", { value: "Tab" });
		target.dispatchEvent(e);
		return e.defaultPrevented;
	};
	try {
		await act(async () => root.render(<QuestionDock {...noop} onLeaveRows={() => { left++; }} toolName="probe" toolCallId="tab_loop" input={input} />));
		assert.equal(tab(host.querySelector('[data-kbdrow="0"]')!), true, "the dock moves focus from the rows to the box");
		assert.equal(left, 1);
		assert.equal(tab(box), false, "the browser's own Tab moves on toward Submit");
		assert.equal(left, 1);
	} finally { await act(async () => root.unmount()); host.remove(); box.remove(); }
});

test("a pointer click on Why does not leave focus on it, like the thinking toggle", async () => {
	const input = { question: "Closest planet?", options: [{ label: "Venus" }, { label: "Mercury" }], correctAnswer: "Mercury", explanation: "Innermost." };
	const answer = { kind: "quiz", questionText: input.question, answers: [{ value: "Venus", label: "Venus" }], correct: false, explanation: input.explanation } as unknown as QuestionAnswerData;
	const host = document.createElement("div"); document.body.append(host);
	const root = createRoot(host);
	try {
		await act(async () => root.render(<AnsweredCard answer={answer} input={input} />));
		const why = host.querySelector<HTMLButtonElement>('[data-testid="answer-toggle"]')!;
		let blurred = 0;
		why.blur = () => { blurred++; };
		// detail 1 marks a pointer click (a keyboard click has detail 0).
		const click = Object.defineProperty(new window.Event("click", { bubbles: true }), "detail", { value: 1 });
		await act(async () => why.dispatchEvent(click));
		assert.equal(why.getAttribute("aria-expanded"), "true");
		assert.equal(blurred, 1);
	} finally { await act(async () => root.unmount()); host.remove(); }
});
