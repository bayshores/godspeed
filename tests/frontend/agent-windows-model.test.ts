/**
 * Settings → Connection, "Your agent" (agent-windows-model.ts): what the
 * teacher's tile says.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { teacherTile } from "../../src/frontend/components/settings/agent-windows-model.ts";

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
