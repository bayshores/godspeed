/**
 * The Class Overview's small derived values (components/overview/
 * overview-model.ts) and its inline-math splitter.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	answeredLessons,
	blockWeight,
	calibrationTakeaway,
	displayName,
	fileHref,
	hasCalibration,
	isLevelOverconfident,
	isStudied,
	lessonHref,
	mostMissesTakeaway,
	questionHref,
} from "../components/overview/overview-model.ts";
import { splitInlineMath } from "../components/overview/inline-math.tsx";
import type { CalibrationLevel, LessonProgress } from "../src/core/index.ts";

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

	it("studied = any fact came up; width weight = facts, at least 1", () => {
		assert.equal(isStudied({ inLessons: 0 }), false);
		assert.equal(isStudied({ inLessons: 1 }), true);
		assert.equal(blockWeight({ facts: 0 }), 1);
		assert.equal(blockWeight({ facts: 18 }), 18);
	});

	it("links: file on the Files page, the lesson, a question's message anchor", () => {
		assert.equal(fileHref("cf_1"), "/class/files#file-cf_1");
		assert.equal(lessonHref("chat 1"), "/chat/chat%201");
		assert.equal(questionHref("c1", "m7"), "/chat/c1#message-m7");
	});

	it("answeredLessons keeps lessons with at least one answer, in order", () => {
		assert.deepEqual(answeredLessons([lesson("a", 0, 0), lesson("b", 1, 2), lesson("c", 3, 3)]).map((l) => l.chatId), ["b", "c"]);
	});

	it("mostMissesTakeaway: the most misses wins, first on a tie; nothing with < 2 lessons or no misses", () => {
		assert.equal(mostMissesTakeaway([lesson("a", 9, 13), lesson("b", 5, 11), lesson("c", 4, 6)]), "Lesson b has the most misses.");
		assert.equal(mostMissesTakeaway([lesson("a", 1, 3), lesson("b", 1, 3)]), "Lesson a has the most misses.");
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
