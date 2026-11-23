/**
 * The Space Overview's small derived values (src/frontend/components/overview/
 * overview-model.ts) and its inline-math splitter.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	calibrationTakeaway,
	deadlineAfter,
	deadlineHref,
	hasCalibration,
	isLevelOverconfident,
	joinAnd,
	lessonHref,
	mostNeeded,
	noteWhen,
	percent,
	progressWords,
	questionHref,
	shownDeadline,
	upcomingDeadlines,
} from "../../src/frontend/components/overview/overview-model.ts";
import { splitInlineMath } from "../../src/frontend/components/overview/inline-math.tsx";
import type { CalibrationLevel } from "../../src/shared/core/index.ts";

const lvl = (level: 1 | 2 | 3 | 4 | 5, right: number, answered: number): CalibrationLevel => ({
	level,
	target: level * 20,
	right,
	answered,
	rate: answered ? right / answered : null,
});

describe("overview-model", () => {
	it("links: the lesson, a question's message anchor", () => {
		assert.equal(lessonHref("chat 1"), "/chat/chat%201");
		assert.equal(questionHref("c1", "m7"), "/chat/c1#message-m7");
	});

	it("overconfident levels: only 4–5, only when below the target", () => {
		assert.equal(isLevelOverconfident(lvl(4, 7, 12)), true);
		assert.equal(isLevelOverconfident(lvl(5, 5, 6)), true);
		assert.equal(isLevelOverconfident(lvl(5, 6, 6)), false);
		assert.equal(isLevelOverconfident(lvl(4, 4, 5)), false, "exactly on target is fine");
		assert.equal(isLevelOverconfident(lvl(2, 0, 4)), false, "levels 1–3 are never red");
		assert.equal(isLevelOverconfident(lvl(4, 0, 0)), false);
	});

	it("calibrationTakeaway lists the red levels", () => {
		const base = [lvl(1, 1, 1), lvl(2, 1, 1), lvl(3, 1, 1)];
		assert.equal(calibrationTakeaway([...base, lvl(4, 1, 2), lvl(5, 1, 2)]), "At 4 and 5 you're right less often than you think.");
		assert.equal(calibrationTakeaway([...base, lvl(4, 2, 2), lvl(5, 1, 2)]), "At 5 you're right less often than you think.");
		assert.equal(calibrationTakeaway([...base, lvl(4, 2, 2), lvl(5, 2, 2)]), null);
	});

	it("hasCalibration once any level has an answer", () => {
		assert.equal(hasCalibration([lvl(1, 0, 0), lvl(5, 0, 0)]), false);
		assert.equal(hasCalibration([lvl(1, 0, 0), lvl(5, 0, 1)]), true);
	});
});

describe("the teacher's note", () => {
	it("when the note was written: today's, yesterday's, a weekday's, then the date", () => {
		const now = new Date(2026, 10, 11, 15, 0).getTime();
		assert.equal(noteWhen(new Date(2026, 10, 11, 9, 0).toISOString(), now), "after today's lesson");
		assert.equal(noteWhen(new Date(2026, 10, 10, 23, 0).toISOString(), now), "after yesterday's lesson");
		assert.equal(noteWhen(new Date(2026, 10, 8, 12, 0).toISOString(), now), "after Sunday's lesson");
		assert.equal(noteWhen(new Date(2026, 9, 20, 12, 0).toISOString(), now), "after the Oct 20 lesson");
		assert.equal(noteWhen("not a date", now), "");
	});
});

describe("deadlines on Progress", () => {
	const NOW = new Date(2026, 9, 27, 12, 0).getTime();
	const due = (id: string, date: string, extra: object = {}) => ({ id, kind: "homework" as const, name: id, date, done: false, ...extra });

	it("upcoming: open and still ahead, soonest first", () => {
		const list = [due("later", "2026-11-05"), due("soon", "2026-10-29"), due("past", "2026-10-20"), due("done", "2026-10-28", { done: true }), due("tonight", "2026-10-27", { time: "23:00" })];
		assert.deepEqual(upcomingDeadlines(list, NOW).map((d) => d.id), ["tonight", "soon", "later"]);
	});

	it("the card's deadline: the soonest ahead, the picked one while it is ahead or ticked done", () => {
		const list = [due("a", "2026-10-28"), due("b", "2026-10-30"), due("past", "2026-10-20"), due("ticked", "2026-10-29", { done: true })];
		const upcoming = upcomingDeadlines(list, NOW);
		assert.equal(shownDeadline(list, upcoming, null)?.id, "a");
		assert.equal(shownDeadline(list, upcoming, "b")?.id, "b");
		assert.equal(shownDeadline(list, upcoming, "ticked")?.id, "ticked", "one just ticked done stays, for Undo");
		assert.equal(shownDeadline(list, upcoming, "past")?.id, "a", "one whose date passed gives way");
		assert.equal(shownDeadline(list, upcoming, "removed")?.id, "a");
		assert.equal(shownDeadline([], [], "a"), null);
	});

	it("Next: the one due after, around to the soonest, none with no other", () => {
		const [a, b, c] = [due("a", "2026-10-28"), due("b", "2026-10-30"), due("c", "2026-11-02")];
		const upcoming = [a, b, c];
		assert.equal(deadlineAfter(upcoming, a)?.id, "b");
		assert.equal(deadlineAfter(upcoming, c)?.id, "a");
		assert.equal(deadlineAfter([a], a), null);
		const ticked = due("ticked", "2026-10-29", { done: true });
		assert.equal(deadlineAfter(upcoming, ticked)?.id, "b", "from a ticked one, the one due after it");
		assert.equal(deadlineAfter(upcoming, due("last", "2026-11-09", { done: true }))?.id, "a");
		assert.equal(deadlineAfter([], ticked), null);
	});

	it("how far: problems done, else how ready, else nothing", () => {
		assert.equal(progressWords({ problems: { done: 2, total: 7 }, ready: 0.5 }), "2 of 7 problems done");
		assert.equal(progressWords({ ready: 0.186 }), "19% ready");
		assert.equal(progressWords({ ready: null }), null);
	});

	it("links and numbers", () => {
		assert.equal(deadlineHref("d 1"), "/space/deadline/d%201");
		assert.equal(percent(0.385), 39);
		assert.equal(joinAnd([]), "");
		assert.equal(joinAnd(["a"]), "a");
		assert.equal(joinAnd(["a", "b"]), "a and b");
		assert.equal(joinAnd(["a", "b", "c"]), "a, b and c");
	});

	const topics = (name: string, list: [string, number | null][]) => ({ name, topics: list.map(([id, rate]) => ({ id, name: id, rate })) });

	it("most needed: the lowest rate wins, untested counting as 0", () => {
		assert.deepEqual(mostNeeded([topics("HW", [["sets", 0.6], ["trees", 0.2]]), topics("Final", [["graphs", null]])]), { topicId: "graphs", name: "graphs", deadlines: ["Final"] });
	});

	it("most needed: a tie goes to the topic more deadlines cover, then the name", () => {
		assert.deepEqual(mostNeeded([topics("HW", [["b", 0.2], ["a", 0.2]]), topics("Final", [["b", 0.2]])]), { topicId: "b", name: "b", deadlines: ["HW", "Final"] });
		assert.equal(mostNeeded([topics("HW", [["b", 0.2], ["a", 0.2]])])?.topicId, "a");
		assert.equal(mostNeeded([topics("HW", [])]), null);
	});
});

describe("splitInlineMath", () => {
	it("splits $…$ and \\(…\\) into math pieces and drops bold/code markers", () => {
		assert.deepEqual(splitInlineMath("Why **is** $E[X]$ and \\(x^2\\) `ok`"), [
			{ math: false, text: "Why is " },
			{ math: true, tex: "E[X]" },
			{ math: false, text: " and " },
			{ math: true, tex: "x^2" },
			{ math: false, text: " ok" },
		]);
	});

	it("plain text stays one piece", () => {
		assert.deepEqual(splitInlineMath("No math here"), [{ math: false, text: "No math here" }]);
	});
});
