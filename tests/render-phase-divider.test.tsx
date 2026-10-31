/**
 * Phase presentation render tests: the dotted transcript boundary rules
 * (src/components/phase-divider.tsx) and where teaching begins inside the
 * flipping message. Same tsx classic-JSX shim as render-cards.test.tsx.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PhaseDivider } from "../src/components/phase-divider.tsx";
import { teachStepIndex } from "../src/core/phases.ts";

describe("PhaseDivider (transcript boundary)", () => {
	it("the plan seam: monochrome dotted rules + label", () => {
		const html = renderToStaticMarkup(<PhaseDivider phase="plan" />);
		assert.ok(html.includes('data-testid="phase-divider-plan"'));
		assert.match(html, /Planning/);
		assert.ok(html.includes("border-dotted"), "dotted rule");
		assert.ok(html.includes("border-border"), "monochrome rule");
		assert.ok(!html.includes("border-phase-"), "phase-colored rules are retired");
	});

	it("the teach seam: monochrome rule", () => {
		const html = renderToStaticMarkup(<PhaseDivider phase="teach" />);
		assert.ok(html.includes('data-testid="phase-divider-teach"'));
		assert.match(html, /Teaching/);
		assert.ok(!html.includes("border-phase-"));
		assert.ok(!html.includes("text-phase-"));
	});

	it("probe renders null (never a boundary — phases only advance)", () => {
		assert.equal(renderToStaticMarkup(<PhaseDivider phase="probe" />), "");
	});
});

describe("teachStepIndex (WHERE teaching begins inside the flipping message)", () => {
	const call = { type: "tool-quiz", input: { nodeId: "n1", question: "q?" } };

	it("the flip call in the message's FIRST step → -1 (divider prepends before the message)", () => {
		assert.equal(teachStepIndex([{ type: "step-start" }, { type: "text" }, call]), -1);
	});

	it("a later step: the boundary's step-start index — between plan presentation and teaching", () => {
		// The stacked-dividers bug shape: plan_init + plan text, then a NEW
		// step that poses the first tagged quiz. The seam is the SECOND
		// step-start (index 3), not before the message.
		const parts = [
			{ type: "step-start" },
			{ type: "tool-plan_init", state: "output-available" },
			{ type: "text", text: "Here is your plan." },
			{ type: "step-start" },
			{ type: "text", text: "Let's begin." },
			call,
		];
		assert.equal(teachStepIndex(parts), 3);
	});

	it("no step-start parts at all (defensive): first step → -1", () => {
		assert.equal(teachStepIndex([{ type: "text" }, call]), -1);
	});

	it("an untagged quiz call is not the flip — scan continues to the tagged one", () => {
		const parts = [
			{ type: "step-start" },
			{ type: "tool-quiz", input: { question: "probe quiz — no nodeId" } },
			{ type: "step-start" },
			call,
		];
		assert.equal(teachStepIndex(parts), 2);
	});

	it("explain calls carry nodeId too — same seam", () => {
		const parts = [
			{ type: "step-start" },
			{ type: "text" },
			{ type: "step-start" },
			{ type: "tool-explain", input: { nodeId: "n2", topic: "t" } },
		];
		assert.equal(teachStepIndex(parts), 2);
	});
});
