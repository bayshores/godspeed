/**
 * Settings → Connection, "Your agent" (agent-windows-model.ts): what the
 * teacher's tile says, plus the launch log outside the desktop app.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { teacherTile } from "../../src/frontend/components/settings/agent-windows-model.ts";
import { logLines, type Launch } from "../../src/frontend/components/agent-folder/agent-folder-model.ts";

describe("the teacher's tile", () => {
	it("teaching while it works on something, else running", () => {
		assert.deepEqual(teacherTile({ text: "Teaching Graphs", working: true }, false), {
			chip: "Teaching",
			line: "Teaching Graphs",
			note: "Teaches and answers you",
		});
		const idle = teacherTile({ text: "Idle", working: false }, false);
		assert.equal(idle.line, "Nothing to do right now");
		assert.equal(idle.chip, "Running", "Teaching only while it works on something");
		assert.equal(teacherTile(null, true).note, "Connected from outside godspeed.");
	});
});

describe("the launch log outside the desktop app", () => {
	it("the learner runs the command, then the agent starts", () => {
		const launch: Launch = { agent: "claude", made: "done" };
		const texts = (l: Launch, connected: boolean) => logLines(l, connected, "~/godspeed").map((line) => line.text);
		assert.deepEqual(texts(launch, false), [
			"Made ~/godspeed",
			"Copy the command and run it in your terminal",
			"Waiting for Claude Code to start…",
			"If Claude Code asks whether to trust the folder, choose Yes.",
		]);
		assert.deepEqual(texts(launch, true), ["Made ~/godspeed", "Copy the command and run it in your terminal", "Started Claude Code"]);
		assert.deepEqual(texts({ agent: "codex", made: { error: "Couldn't reach godspeed. Try again." } }, false), ["Couldn't reach godspeed. Try again."]);
	});
});
