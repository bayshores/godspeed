/**
 * The class cover's numbers: how much of the signature is inked and where
 * the progress label hangs.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { firstSentence, labelHangsLeft, noteWhen, studiedShare } from "../src/components/overview/class-cover-model.ts";

describe("class cover", () => {
	it("inks the share of facts studied, 0 with no facts, never past 1", () => {
		assert.equal(studiedShare({ studied: 84, total: 212 }), 84 / 212);
		assert.equal(studiedShare({ studied: 0, total: 0 }), 0);
		assert.equal(studiedShare({ studied: 5, total: 4 }), 1);
	});

	it("the description's first sentence; a line with no sentence end is kept whole", () => {
		assert.equal(firstSentence("UCSD CSE 21, Fall 2026: Discrete math. Textbook: Rosen."), "UCSD CSE 21, Fall 2026: Discrete math.");
		assert.equal(firstSentence("Calc III\nTextbook: Stewart."), "Calc III");
		assert.equal(firstSentence("Version 2.0 notes"), "Version 2.0 notes", "a dot inside a word doesn't end it");
		assert.equal(firstSentence(""), "");
	});

	it("when the note was written: today's, yesterday's, a weekday's, then the date", () => {
		const now = new Date(2026, 9, 28, 16, 0).getTime();
		const at = (m: number, d: number, h = 10) => new Date(2026, m, d, h).toISOString();
		assert.equal(noteWhen(at(9, 28), now), "after today's lesson");
		assert.equal(noteWhen(at(9, 27, 23), now), "after yesterday's lesson");
		assert.equal(noteWhen(at(9, 24), now), "after Saturday's lesson");
		assert.equal(noteWhen(at(9, 14), now), "after the Oct 14 lesson");
		assert.equal(noteWhen("garbage", now), "");
	});

	it("the label hangs left of the line's end once it's far enough in", () => {
		assert.equal(labelHangsLeft(0.05), false);
		assert.equal(labelHangsLeft(0.4), true);
	});
});
