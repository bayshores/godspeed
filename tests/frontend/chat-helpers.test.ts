import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { goAheadLabel, problemPosed, restoreUnsent, sendBlockedReason } from "../../src/frontend/components/lesson/chat-helpers.ts";
import type { LhMessage } from "../../src/shared/core/index.ts";

describe("restoreUnsent", () => {
	it("fills an empty composer with the unsent text", () => {
		assert.equal(restoreUnsent("wait, why?", ""), "wait, why?");
		assert.equal(restoreUnsent("wait, why?", "  \n"), "wait, why?");
	});

	it("puts the unsent text and a newline ahead of a new draft", () => {
		assert.equal(restoreUnsent("wait, why?", "and also"), "wait, why?\nand also");
	});
});

describe("sendBlockedReason", () => {
	it("says why the box can't take text", () => {
		assert.equal(sendBlockedReason(false), null);
		assert.equal(sendBlockedReason(true), "Answer or skip the waiting question first.");
	});
});

describe("goAheadLabel", () => {
	const idle = { kind: "study" as const, problemList: false, startLabel: null, teacherSpoke: true, posedAny: false };

	it("study says Continue once the teacher has spoken, with no problem ever posed", () => {
		assert.equal(goAheadLabel(idle), "Continue");
		assert.equal(goAheadLabel({ ...idle, teacherSpoke: false }), null);
	});

	it("practice needs a posed problem", () => {
		assert.equal(goAheadLabel({ ...idle, kind: "practice" }), null);
		assert.equal(goAheadLabel({ ...idle, kind: "practice", posedAny: true }), "Next problem");
	});

	it("homework needs a start label and the teacher having spoken", () => {
		const homework = { ...idle, kind: "homework" as const, problemList: true };
		assert.equal(goAheadLabel({ ...homework, startLabel: "Start Problem 2" }), "Start Problem 2");
		assert.equal(goAheadLabel(homework), null);
		assert.equal(goAheadLabel({ ...homework, startLabel: "Start Problem 2", teacherSpoke: false }), null);
	});

	it("a teach lesson that never posed a problem never gets it", () => {
		assert.equal(goAheadLabel({ ...idle, kind: "teach" }), null);
	});
});

describe("problemPosed", () => {
	it("is true once an assistant message calls the problem tool", () => {
		const call = (name: string) => ({ role: "assistant", content: [{ type: "toolCall", id: "c", name, arguments: {} }] }) as unknown as LhMessage;
		assert.equal(problemPosed([call("question_text")]), false);
		assert.equal(problemPosed([call("question_text"), call("problem")]), true);
		assert.equal(problemPosed([]), false);
	});
});
