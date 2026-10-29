/**
 * The teaching areas (src/core/teaching-areas.ts): every prompt part has
 * exactly one area and a plain name, rules are cleaned on the way in, and
 * the rules section the teacher reads is pinned word for word.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { effectivePromptSegments } from "../src/agent/prompt-segments.ts";
import {
	PART_NAMES,
	RULES_MAX,
	RULE_MAX_CHARS,
	TEACHING_AREAS,
	learnerRulesSection,
	oneLine,
	sanitizeAreaRules,
	sanitizeRules,
} from "../src/core/teaching-areas.ts";

describe("TEACHING_AREAS covers the prompt", () => {
	it("every teacher and prober part sits in exactly one area, and every area part exists", () => {
		const current = new Set([...effectivePromptSegments("teacher"), ...effectivePromptSegments("prober")].map((s) => s.path));
		const mapped = TEACHING_AREAS.flatMap((a) => a.parts);
		assert.equal(new Set(mapped).size, mapped.length, "no part in two areas");
		assert.deepEqual([...current].sort(), [...mapped].sort(), "a new prompt file needs an area (and an old one leaves)");
	});

	it("every part has a plain name", () => {
		for (const path of TEACHING_AREAS.flatMap((a) => a.parts)) assert.ok(PART_NAMES[path], path);
	});
});

describe("rules are cleaned on the way in", () => {
	it("oneLine flattens line breaks and control characters, then trims to the limit", () => {
		assert.equal(oneLine("  No\njokes\u0000 ever please ", 200), "No jokes ever please");
		assert.equal(oneLine("abcdef", 3), "abc");
	});

	it("sanitizeRules drops non-strings, blanks and repeats, and caps length and count", () => {
		assert.deepEqual(sanitizeRules(["a", 1, " ", "a", " b "]), ["a", "b"]);
		assert.equal(sanitizeRules(["x".repeat(500)])[0]?.length, RULE_MAX_CHARS);
		assert.equal(sanitizeRules(Array.from({ length: 30 }, (_, i) => `rule ${i}`)).length, RULES_MAX);
		assert.deepEqual(sanitizeRules("not a list"), []);
	});

	it("sanitizeAreaRules keeps known areas with rules and drops the rest", () => {
		assert.deepEqual(sanitizeAreaRules({ voice: ["No jokes"], facts: [], mood: ["x"] }), { voice: ["No jokes"] });
		assert.deepEqual(sanitizeAreaRules(null), {});
		assert.deepEqual(sanitizeAreaRules(["voice"]), {});
	});
});

describe("learnerRulesSection — what the teacher reads", () => {
	it("no rules anywhere: nothing is added", () => {
		assert.equal(learnerRulesSection({}), "");
		assert.equal(learnerRulesSection({}, { name: "CSE 21", rules: [] }), "");
	});

	it("area rules in area order, then the class's rules", () => {
		const text = learnerRulesSection(
			{ files: ["Quote page numbers"], voice: ["No jokes", "Short answers"] },
			{ name: "CSE 21", rules: ["Use the textbook's notation"] },
		);
		assert.equal(
			text,
			[
				"## The learner's rules",
				"The learner wrote these rules. Follow them. Where a rule conflicts with the instructions above, the rule wins.",
				"Voice\n- No jokes\n- Short answers",
				"Your files and formatting\n- Quote page numbers",
				"Rules for this class (CSE 21)\n- Use the textbook's notation",
			].join("\n\n"),
		);
	});
});
