/**
 * The Space Overview's small derived values (src/frontend/components/overview/
 * overview-model.ts) and its inline-math splitter.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	answeredLessons,
	calibrationTakeaway,
	deadlineHref,
	displayName,
	hasCalibration,
	isLevelOverconfident,
	joinAnd,
	lessonHref,
	mostMissesTakeaway,
	mostNeeded,
	nextDeadlineButton,
	noteWhen,
	percent,
	progressShare,
	progressWords,
	questionHref,
	recentLessons,
	scoreLine,
	upcomingDeadlines,
} from "../../src/frontend/components/overview/overview-model.ts";
import { splitInlineMath } from "../../src/frontend/components/overview/inline-math.tsx";
import type { CalibrationLevel, LessonProgress } from "../../src/shared/core/index.ts";

const lvl = (level: 1 | 2 | 3 | 4 | 5, right: number, answered: number): CalibrationLevel => ({
	level,
	target: level * 20,
	right,
	answered,
	rate: answered ? right / answered : null,
});

const lesson = (chatId: string, right: number, answered: number): LessonProgress => ({
	chatId,
	title: `Lesson ${chatId}`,
	kind: "teach",
	updatedAt: "",
	answers: Array.from({ length: answered }, (_, i) => ({ chatId, toolCallId: `${chatId}${i}`, outcome: i < right ? "right" : "wrong", answeredAt: "" })),
	right,
	answered,
	score: answered ? right / answered : null,
});

describe("overview-model", () => {
	it("displayName drops the extension only", () => {
		assert.equal(displayName("Lecture 3 — Expectation.pdf"), "Lecture 3 — Expectation");
		assert.equal(displayName("ps1.1.txt"), "ps1.1");
		assert.equal(displayName("README"), "README");
		assert.equal(displayName(".hidden"), ".hidden");
	});

	it("links: the lesson, a question's message anchor", () => {
		assert.equal(lessonHref("chat 1"), "/chat/chat%201");
		assert.equal(questionHref("c1", "m7"), "/chat/c1#message-m7");
	});

	it("answeredLessons keeps lessons with at least one answer, in order", () => {
		assert.deepEqual(answeredLessons([lesson("a", 0, 0), lesson("b", 1, 2), lesson("c", 3, 3)]).map((l) => l.chatId), ["b", "c"]);
	});

	it("mostMissesTakeaway: the most misses wins, ties are said; nothing with < 2 lessons or no misses", () => {
		assert.equal(mostMissesTakeaway([lesson("a", 9, 13), lesson("b", 5, 11), lesson("c", 4, 6)]), "“Lesson b” has the most misses.");
		assert.equal(mostMissesTakeaway([lesson("a", 1, 3), lesson("b", 1, 3)]), "Both lessons have 2 misses.");
		assert.equal(mostMissesTakeaway([lesson("a", 1, 3), lesson("b", 1, 3), lesson("c", 2, 3)]), "“Lesson a” and “Lesson b” have the most misses, 2 misses each.");
		assert.equal(mostMissesTakeaway([{ ...lesson("a", 0, 3), title: "ok lets prep." }, lesson("b", 1, 2)]), "“ok lets prep” has the most misses.");
		assert.equal(mostMissesTakeaway([lesson("a", 1, 3)]), null);
		assert.equal(mostMissesTakeaway([lesson("a", 3, 3), lesson("b", 2, 2)]), null);
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

	it("how far: problems done, else how ready, else nothing", () => {
		assert.equal(progressWords({ problems: { done: 2, total: 7 }, ready: 0.5 }), "2 of 7 problems done");
		assert.equal(progressWords({ ready: 0.186 }), "19% ready");
		assert.equal(progressWords({ ready: null }), null);
		assert.equal(progressShare({ problems: { done: 2, total: 8 }, ready: 0.5 }), 0.25);
		assert.equal(progressShare({ problems: { done: 0, total: 0 }, ready: 0.5 }), 0);
		assert.equal(progressShare({ ready: 0.4 }), 0.4);
		assert.equal(progressShare({ ready: null }), null);
	});

	it("the button: work on homework and projects, study for tests", () => {
		assert.equal(nextDeadlineButton({ kind: "homework", name: "HW6" }), "Work on HW6");
		assert.equal(nextDeadlineButton({ kind: "project", name: "PA2" }), "Work on PA2");
		assert.equal(nextDeadlineButton({ kind: "exam", name: "Final" }), "Study for Final");
		assert.equal(nextDeadlineButton({ kind: "quiz", name: "Quiz 3" }), "Study for Quiz 3");
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

describe("pick up where you left off", () => {
	it("the three lessons worked on last, newest first", () => {
		const at = (id: string, updatedAt: string) => ({ ...lesson(id, 0, 0), updatedAt });
		assert.deepEqual(recentLessons([at("a", "2026-10-01"), at("b", "2026-10-04"), at("c", "2026-10-02"), at("d", "2026-10-03")]).map((l) => l.chatId), ["b", "d", "c"]);
	});

	it("a lesson's score, or that it has no answers", () => {
		assert.equal(scoreLine({ right: 4, answered: 6 }), "4 of 6 right");
		assert.equal(scoreLine({ right: 0, answered: 0 }), "No answers yet");
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
