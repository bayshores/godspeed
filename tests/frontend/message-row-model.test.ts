/**
 * Reply rows draw a step separator only between steps that show something.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LhViewPart } from "../../src/shared/core/index.ts";
import { drawnSeparators } from "../../src/frontend/components/lesson/message-row-model.ts";

const step: LhViewPart = { type: "step-start" };
const text = (t: string): LhViewPart => ({ type: "text", id: t, text: t, state: "done" });
const hidden: LhViewPart = { type: "tool-search_class_files", state: "output-available", toolCallId: "s" };
const shows = (p: LhViewPart) => p.type === "text";

describe("drawnSeparators", () => {
	it("draws one line between two shown steps, never before the first", () => {
		assert.deepEqual([...drawnSeparators([step, text("a"), step, text("b")], shows)], [2]);
	});

	it("draws nothing for steps of hidden work", () => {
		const parts = [step, text("a"), step, hidden, step, hidden, hidden, step, hidden];
		assert.deepEqual([...drawnSeparators(parts, shows)], []);
	});

	it("draws one line where hidden steps sit between shown ones", () => {
		const parts = [step, text("a"), step, hidden, step, hidden, step, text("b")];
		assert.deepEqual([...drawnSeparators(parts, shows)], [6]);
	});

	it("skips a leading hidden step", () => {
		assert.deepEqual([...drawnSeparators([step, hidden, step, text("a"), step, text("b")], shows)], [4]);
	});
});
