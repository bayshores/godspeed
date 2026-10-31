import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { switchedOffToolsNote, TOGGLEABLE_TOOLS } from "../src/core/tool-switches.ts";

describe("switchedOffToolsNote", () => {
	it("is empty when every switch is on, so the default prompt is unchanged", () => {
		assert.equal(switchedOffToolsNote(undefined, TOGGLEABLE_TOOLS), "");
		assert.equal(switchedOffToolsNote({}, TOGGLEABLE_TOOLS), "");
		assert.equal(switchedOffToolsNote({ research: true, explain: true }, TOGGLEABLE_TOOLS), "");
	});

	it("names one switched-off tool by its Settings label and tool name", () => {
		assert.equal(
			switchedOffToolsNote({ research: false }, TOGGLEABLE_TOOLS),
			"The learner switched off Web research (`research`) in Settings, so that tool is gone. Don't plan around it or offer it.",
		);
	});

	it("lists several in one line", () => {
		assert.equal(
			switchedOffToolsNote({ research: false, visual: false, pdf: false }, TOGGLEABLE_TOOLS),
			"The learner switched off Web research (`research`), Figures (`visual`) and PDF reading (`pdf`) in Settings, so those tools are gone. Don't plan around them or offer them.",
		);
	});

	it("skips switches the agent doesn't carry", () => {
		assert.equal(switchedOffToolsNote({ demo: false, visual: false }, ["research", "pdf"]), "");
		assert.equal(
			switchedOffToolsNote({ demo: false, pdf: false }, ["research", "pdf"]),
			"The learner switched off PDF reading (`pdf`) in Settings, so that tool is gone. Don't plan around it or offer it.",
		);
	});
});
