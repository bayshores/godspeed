/**
 * Settings → Connection, "Your agent" (agent-windows-model.ts): the
 * headline and what the Teacher and Helper tiles say, plus the helper's
 * lines in the launch log outside the desktop app.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filesLine, helperTile, teacherTile, windowsHeadline } from "../../src/frontend/components/settings/agent-windows-model.ts";
import { logLines, type Launch } from "../../src/frontend/components/agent-folder/agent-folder-model.ts";

const agent = (over: Partial<Parameters<typeof windowsHeadline>[0]> = {}) => ({
	connected: false,
	teaching: false,
	helperHere: false,
	helperCovering: false,
	pendingTurns: 0,
	...over,
});

const helper = (over: Partial<Parameters<typeof helperTile>[0]> = {}) => helperTile({ agent: agent(), background: null, files: null, filesLeft: 0, teacher: "Teacher", ...over });

describe("the agent's two windows", () => {
	it("the headline says which windows are open", () => {
		assert.equal(windowsHeadline(agent()), "No window is open");
		assert.equal(windowsHeadline(agent({ connected: true, teaching: true })), "The teacher window is open");
		assert.equal(windowsHeadline(agent({ connected: true, helperHere: true })), "Only the helper window is open");
		assert.equal(windowsHeadline(agent({ connected: true, teaching: true, helperHere: true })), "Both windows are open");
	});

	it("the teacher's tile: teaching, open and not started, or closed with a button", () => {
		const teaching = agent({ connected: true, teaching: true });
		assert.deepEqual(teacherTile(teaching, { text: "Teaching Graphs", working: true }), {
			tone: "on",
			chip: "Teaching",
			line: "Teaching Graphs",
			note: "Teaches and answers you",
			open: null,
		});
		assert.equal(teacherTile(teaching, { text: "Idle", working: false }).line, "Nothing to do right now");
		assert.equal(teacherTile(agent({ connected: true, name: "Codex" }), null).line, "Tell Codex to start teaching.");
		assert.deepEqual(teacherTile(agent(), null), { tone: "off", chip: "Closed", line: "Not open", note: "Start it and it teaches you", open: "Start teacher" });
		assert.equal(teacherTile(agent({ pendingTurns: 1 }), null).line, "Your lesson is waiting");
		assert.equal(teacherTile(agent({ connected: true, teaching: true }), null, true).note, "Connected from outside godspeed.");
	});

	it("a helper alone does not count as the teacher's window", () => {
		assert.equal(teacherTile(agent({ connected: true, helperHere: true }), null).chip, "Closed");
	});

	it("the helper's tile when closed says what waits and who reads meanwhile", () => {
		assert.deepEqual(helper(), { tone: "off", chip: "Closed", line: "Not open", note: "Reads your files so the teacher stays free", open: "Start helper" });
		const waiting = helper({ filesLeft: 3 });
		assert.equal(waiting.line, "3 files are waiting");
		assert.equal(waiting.note, "Start it and it reads them");
		assert.equal(helper({ filesLeft: 1 }).line, "1 file is waiting");
		assert.equal(helper({ agent: agent({ connected: true, teaching: true }), filesLeft: 3 }).note, "Teacher does the reading between your messages");
	});

	it("the helper's tile when open: idle, reading, another job, or covering", () => {
		const here = agent({ connected: true, teaching: true, helperHere: true });
		assert.deepEqual(helper({ agent: here }), { tone: "on", chip: "Open", line: "Nothing to do right now", note: "It starts by itself when you add files", open: null });
		assert.deepEqual(helper({ agent: here, background: { text: "Reading week3.pdf", count: "part 2 of 5" }, files: "6 of 17 files in CSE 21", filesLeft: 11 }), {
			tone: "busy",
			chip: "Reading",
			line: "Reading week3.pdf, part 2 of 5",
			note: "6 of 17 files in CSE 21",
			open: null,
		});
		const job = helper({ agent: here, background: { text: "Making a cheat sheet" } });
		assert.equal(job.chip, "Working");
		assert.equal(job.note, "Does the background work");
		assert.deepEqual(helper({ agent: { ...here, helperCovering: true }, teacher: "Ada" }), {
			tone: "busy",
			chip: "Covering",
			line: "Answering for Ada for a minute",
			note: "Ada is tidying its memory",
			open: null,
		});
	});

	it("filesLine adds up every space being read", () => {
		const space = (name: string, filesLeft: number, filesRead?: number, closed = false) => ({ name, filesLeft, filesRead, closed });
		assert.equal(filesLine([space("CSE 21", 0)]), null);
		assert.equal(filesLine([space("CSE 21", 11, 6), space("Old", 4, 1, true)]), "6 of 17 files in CSE 21");
		assert.equal(filesLine([space("CSE 21", 1), space("CSE 29", 2, 1)]), "1 of 4 files in 2 spaces");
	});
});

describe("the launch log outside the desktop app", () => {
	it("the learner runs the command; the helper's line shows when only the helper was asked for", () => {
		const launch: Launch = { agent: "claude", made: "done" };
		const texts = (l: Launch, status: { connected: boolean; teaching: boolean; helperHere: boolean }) => logLines(l, status, "~/godspeed").map((line) => line.text);
		assert.deepEqual(texts(launch, { connected: false, teaching: false, helperHere: false }), [
			"Made ~/godspeed",
			"Copy the command and run it in your terminal",
			"Waiting for Claude Code to start…",
			"If Claude Code asks whether to trust the folder, choose Yes.",
		]);
		assert.deepEqual(texts(launch, { connected: true, teaching: true, helperHere: false }), [
			"Made ~/godspeed",
			"Copy the command and run it in your terminal",
			"Started Claude Code",
			"Claude Code is teaching",
		]);
		assert.deepEqual(texts({ ...launch, helperOnly: true }, { connected: false, teaching: false, helperHere: true }), ["Made ~/godspeed", "Copy the command and run it in your terminal", "Started the helper"]);
		assert.deepEqual(texts({ agent: "codex", made: { error: "Couldn't reach godspeed. Try again." } }, { connected: false, teaching: false, helperHere: false }), ["Couldn't reach godspeed. Try again."]);
	});
});
