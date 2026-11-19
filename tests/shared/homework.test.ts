import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { homeworkProblems } from "../../src/shared/core/homework.ts";

const P = (number: string, done = false) => ({ number, title: `t${number}`, text: "…", done });

describe("homework problems", () => {
	it("keeps done marks by number when the list is posted again", () => {
		const posted = { parts: [{ type: "tool-post_problems", state: "output-available", input: { problems: [{ number: "2", title: "b", text: "…" }, { number: "1", title: "a", text: "…" }, { number: "3", title: "c", text: "…" }] } }] };
		const { problems } = homeworkProblems([P("1", true), P("2")], [posted]);
		assert.deepEqual(problems.map((p) => [p.number, p.done]), [["2", false], ["1", true], ["3", false]]);
	});

	it("folds posts, opens and solved concludes over the lesson's messages", () => {
		const part = (type: string, input: unknown, state = "output-available") => ({ parts: [{ type, input, state }] });
		const { problems, open } = homeworkProblems([], [
			part("tool-post_problems", { problems: [{ number: "1", title: "a", text: "…" }, { number: "2", title: "b", text: "…" }] }),
			part("tool-problem", { number: "1", statement: "…" }),
			part("tool-conclude", { outcome: "solvedWithHints", verdict: "ok" }),
			part("tool-problem", { number: "2", statement: "…" }),
			part("tool-conclude", { outcome: "movedOn", verdict: "later" }),
			part("tool-problem", { number: "2", statement: "…" }),
			// A refused call changes nothing.
			part("tool-conclude", { outcome: "solved", verdict: "x" }, "output-error"),
		]);
		assert.deepEqual(problems.map((p) => [p.number, p.done]), [["1", true], ["2", false]]);
		assert.equal(open, "2");
	});

	it("keeps the part marked in the open problem until it closes", () => {
		const part = (type: string, input: unknown, state = "output-available") => ({ parts: [{ type, input, state }] });
		const opened = [part("tool-problem", { number: "1", statement: "…" }), part("tool-part", { part: "a" }), part("tool-part", { part: " b " })];
		assert.equal(homeworkProblems([], opened).part, "b");
		assert.equal(homeworkProblems([], [...opened, part("tool-part", { part: "c" }, "output-error")]).part, "b");
		assert.equal(homeworkProblems([], [...opened, part("tool-conclude", { outcome: "movedOn", verdict: "x" })]).part, null);
		assert.equal(homeworkProblems([], [...opened, part("tool-problem", { number: "2", statement: "…" })]).part, null);
		assert.equal(homeworkProblems([], [part("tool-part", { part: "a" })]).part, null);
	});
});
