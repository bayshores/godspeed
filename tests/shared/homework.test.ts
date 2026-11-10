import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	homeworkContextText,
	homeworkProblems,
	latestHomework,
	mergeProblems,
	problemLabel,
	problemSource,
	problemsDone,
} from "../../src/shared/core/homework.ts";

const P = (number: string, done = false) => ({ number, title: `t${number}`, text: "…", done });

describe("homework problems", () => {
	it("keeps done marks by number when the list is posted again", () => {
		const merged = mergeProblems([P("1", true), P("2")], [{ number: "2", title: "b", text: "…" }, { number: "1", title: "a", text: "…" }, { number: "3", title: "c", text: "…" }]);
		assert.deepEqual(merged.map((p) => [p.number, p.done]), [["2", false], ["1", true], ["3", false]]);
	});

	it("counts done, and has no count with no problems", () => {
		assert.deepEqual(problemsDone([P("1", true), P("2")]), { done: 1, total: 2 });
		assert.equal(problemsDone([]), null);
		assert.equal(problemsDone(undefined), null);
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

	it("reopens the latest homework session on a deadline", () => {
		const sessions = [
			{ chatId: "a", deadlineId: "d", createdAt: "2026-11-01" },
			{ chatId: "b", deadlineId: "d", createdAt: "2026-11-03" },
			{ chatId: "c", deadlineId: "e", createdAt: "2026-11-04" },
		];
		assert.equal(latestHomework("d", sessions), "b");
		assert.equal(latestHomework("x", sessions), null);
	});

	it("names problems and where they are", () => {
		assert.equal(problemLabel("3"), "Q3");
		assert.equal(problemLabel("2b"), "Q2b");
		assert.equal(problemLabel("Ex. 4"), "Ex. 4");
		assert.equal(problemSource({ name: "hw4.pdf" }, 2), "from hw4.pdf, page 2");
		assert.equal(problemSource({ name: "hw4.pdf" }, undefined), "from hw4.pdf");
		assert.equal(problemSource(null, 2), null);
	});

	it("tells the teacher what is posted and what is done", () => {
		const text = homeworkContextText({ name: "HW 4", kind: "homework", date: "2026-11-13", time: "23:59" }, { id: "f1", name: "hw4.pdf", path: "/x/hw4.pdf" }, [P("1", true), P("2")]);
		assert.match(text, /HW 4 \(homework\), due 2026-11-13 23:59/);
		assert.match(text, /hw4\.pdf \(file id f1\), at \/x\/hw4\.pdf/);
		assert.match(text, /- 1: t1 \(done\)\n- 2: t2/);
	});
});
