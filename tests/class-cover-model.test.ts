/**
 * The class cover's numbers: how much of the signature is inked and where
 * the progress label hangs.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { labelHangsLeft, studiedShare } from "../src/components/overview/class-cover-model.ts";

describe("class cover", () => {
	it("inks the share of facts studied, 0 with no facts, never past 1", () => {
		assert.equal(studiedShare({ studied: 84, total: 212 }), 84 / 212);
		assert.equal(studiedShare({ studied: 0, total: 0 }), 0);
		assert.equal(studiedShare({ studied: 5, total: 4 }), 1);
	});

	it("the label hangs left of the line's end once it's far enough in", () => {
		assert.equal(labelHangsLeft(0.05), false);
		assert.equal(labelHangsLeft(0.4), true);
	});
});
