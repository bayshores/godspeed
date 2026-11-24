/**
 * The lesson text drawn as one sheet per step: a sheet for each step that has something on it,
 * the step's number on its tab, the newest sheet filling the window and holding Stop, and a
 * reply that runs over two steps drawn half on each.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ReadingPane } from "../../src/frontend/components/lesson/reading-pane.tsx";
import { NO_LESSON_WORK, type LhViewMessage, type LhViewPart } from "../../src/shared/core/index.ts";

const step: LhViewPart = { type: "step-start" };
const text = (id: string, words: string, extra: Partial<LhViewPart> = {}): LhViewPart => ({ type: "text", id, text: words, state: "done", ...extra });
const answer = { kind: "quiz", tool: "quiz", questionType: "predict", questionText: "What prints?", dontKnow: false, answers: [{ index: 1, label: "Nothing", value: "none" }], options: [{ index: 1, label: "Nothing" }], correct: false, answeredAt: "2026-11-20T00:00:00.000Z" };
const quiz = (id: string, nodeId: string, answered: boolean): LhViewPart => ({
	type: "tool-quiz",
	toolCallId: id,
	input: { type: "predict", nodeId, question: "What prints?", options: [{ label: "Nothing" }], correctAnswer: "Nothing", explanation: "" },
	state: answered ? "output-available" : "input-available",
	...(answered ? { output: answer } : {}),
});
const PLAN = new Map([["fork", 1], ["exec", 2]]);
const NAMES = new Map([["fork", "Fork"], ["exec", "Exec"]]);

type Props = React.ComponentProps<typeof ReadingPane>;
function pane(messages: LhViewMessage[], over: Partial<Props> = {}): string {
	return renderToStaticMarkup(
		<ReadingPane
			spaceId={undefined}
			stepNumbers={PLAN}
			stepNames={NAMES}
			echo={-1}
			messages={messages}
			phases={[]}
			status="ready"
			busy={false}
			stoppedEmpty={false}
			waitingForAgent={false}
			work={NO_LESSON_WORK}
			onStop={() => {}}
			queuedSteers={[]}
			arrivalsLive={false}
			pageMarks={new Map()}
			arrive={() => undefined}
			bookTurns={false}
			onDesk={() => {}}
			{...over}
		/>,
	);
}
const sheets = (html: string) => html.split('data-testid="lesson-sheet"').slice(1);

describe("the lesson text as sheets", () => {
	const twoSteps: LhViewMessage[] = [
		{ id: "a1", role: "assistant", parts: [step, text("a1-t0", "Fork copies the process."), quiz("q1", "fork", true), step, text("a1-t1", "Right, both run on."), text("lead", "Now exec.", { opens: "exec" })] },
		{ id: "u1", role: "user", parts: [{ type: "text", text: "What is exec?" }] },
		{ id: "a2", role: "assistant", parts: [step, text("a2-t0", "It starts a new program.")] },
	];

	it("draws a section per step, each headed by its number on a block and its name, and the same reply half on each", () => {
		const [one, two, ...more] = sheets(pane(twoSteps));
		assert.equal(more.length, 0);
		assert.match(one!, /data-testid="sheet-step"[^>]*><span[^>]*><span class="sr-only">Step <\/span>1<\/span>Fork</);
		assert.match(one!, /Fork copies the process\.[\s\S]*Right, both run on\./);
		assert.doesNotMatch(one!, /Now exec\./);
		assert.match(two!, /data-testid="sheet-step"[^>]*><span[^>]*><span class="sr-only">Step <\/span>2<\/span>Exec</);
		assert.match(two!, /Now exec\.[\s\S]*What is exec\?[\s\S]*It starts a new program\./);
	});

	it("only the newest sheet fills the window and holds Stop", () => {
		const [one, two] = sheets(pane(twoSteps, { busy: true, status: "submitted" }));
		assert.doesNotMatch(one!.slice(0, 200), /lh-text-fit/);
		assert.match(two!.slice(0, 200), /lh-text-fit/);
		assert.doesNotMatch(one!, /data-testid="stop-turn"/);
		assert.match(two!, /data-testid="stop-turn"/);
	});

	it("a step whose first question still waits has no section yet, and one section alone has no heading", () => {
		const waiting: LhViewMessage[] = [{ id: "a1", role: "assistant", parts: [step, quiz("q1", "fork", true), step, text("a1-t1", "Right."), quiz("q2", "exec", false)] }];
		const drawn = sheets(pane(waiting));
		assert.equal(drawn.length, 1);
		assert.doesNotMatch(drawn[0]!, /data-testid="sheet-step"/, "the step line already says which step it is");
		const answered: LhViewMessage[] = [{ id: "a1", role: "assistant", parts: [step, quiz("q1", "fork", true), step, text("a1-t1", "Right."), quiz("q2", "exec", true)] }];
		assert.equal(sheets(pane(answered)).length, 2, "his answer starts it");
	});

	it("a lesson with no steps is one sheet with no tab, and an empty one still draws its sheet", () => {
		const plain = pane([{ id: "a1", role: "assistant", parts: [step, text("a1-t0", "Hello.")] }]);
		assert.equal(sheets(plain).length, 1);
		assert.doesNotMatch(plain, /sheet-step/);
		assert.equal(sheets(pane([], { busy: true, status: "submitted" })).length, 1);
	});
});
