/**
 * Settings → Connection, "Your agent" (agent-windows-model.ts): the
 * headline and what the Teacher and Helper tiles say, plus the helper's
 * lines in the launch log and which terminals a click opens.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filesLine, helperTile, teacherTile, windowsHeadline } from "../../src/frontend/components/settings/agent-windows-model.ts";
import { logLines, startTargets, type Launch } from "../../src/frontend/components/agent-folder/agent-folder-model.ts";

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
		assert.deepEqual(teacherTile(agent(), null), { tone: "off", chip: "Closed", line: "Not open", note: "Open it and it starts teaching", open: "Open teacher" });
		assert.equal(teacherTile(agent({ pendingTurns: 1 }), null).line, "Your lesson is waiting");
	});

	it("a helper alone does not count as the teacher's window", () => {
		assert.equal(teacherTile(agent({ connected: true, helperHere: true }), null).chip, "Closed");
	});

	it("the helper's tile when closed says what waits and who reads meanwhile", () => {
		assert.deepEqual(helper(), { tone: "off", chip: "Closed", line: "Not open", note: "Reads your files so the teacher stays free", open: "Open helper" });
		const waiting = helper({ filesLeft: 3 });
		assert.equal(waiting.line, "3 files are waiting");
		assert.equal(waiting.note, "Open it and it starts reading");
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

describe("opening the windows", () => {
	it("a click opens the agent and its helper, the agent alone when a helper is here, or the helper alone", () => {
		assert.deepEqual(startTargets("claude", false, false), ["claude", "claude-helper"]);
		assert.deepEqual(startTargets("claude", true, false), ["claude"]);
		assert.deepEqual(startTargets("codex", false, true), ["codex-helper"]);
	});

	it("the log follows the helper after the teacher, and alone for Open helper", () => {
		const launch: Launch = { agent: "claude", made: "done", opened: "done" };
		const texts = (l: Launch, status: { connected: boolean; teaching: boolean; helperHere: boolean }) => logLines(l, status, "~/godspeed", true).map((line) => line.text);
		assert.deepEqual(texts(launch, { connected: true, teaching: true, helperHere: false }), [
			"Made ~/godspeed",
			"Opened Terminal in it",
			"Started Claude Code",
			"Claude Code is teaching",
			"Waiting for the helper to start…",
		]);
		assert.equal(texts(launch, { connected: true, teaching: true, helperHere: true }).at(-1), "Started the helper");
		assert.deepEqual(texts({ ...launch, helperOnly: true }, { connected: false, teaching: false, helperHere: true }), ["Made ~/godspeed", "Opened Terminal in it", "Started the helper"]);
		// Run by hand outside the desktop app: one window, so no helper line.
		assert.equal(texts({ ...launch, opened: "manual" }, { connected: true, teaching: true, helperHere: false }).at(-1), "Claude Code is teaching");
	});
});
