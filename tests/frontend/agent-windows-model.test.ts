/**
 * Settings → Connection, "Your agent" (agent-windows-model.ts): the
 * headline and what the Teacher and Helper tiles say, plus the helper's
 * lines in the launch log outside the desktop app.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentHeadline, filesLine, helperTile, teacherTile } from "../../src/frontend/components/settings/agent-windows-model.ts";
import { logLines, type Launch } from "../../src/frontend/components/agent-folder/agent-folder-model.ts";

const agent = (over: Partial<Parameters<typeof agentHeadline>[0]> = {}) => ({
	connected: false,
	teaching: false,
	helperHere: false,
	helperCovering: false,
	pendingTurns: 0,
	...over,
});

const own = { outside: false, term: null };
const helper = (over: Partial<Parameters<typeof helperTile>[0]> = {}) =>
	helperTile({ agent: agent(), background: null, files: null, filesLeft: 0, teacher: "Teacher", term: null, autoStart: false, ...over });

describe("the teacher and the helper", () => {
	it("the headline says whether the teacher runs or starts", () => {
		assert.equal(agentHeadline(agent(), "Ada", false), "No agent is running");
		assert.equal(agentHeadline(agent(), "Ada", true), "Ada is starting");
		assert.equal(agentHeadline(agent({ connected: true, teaching: true }), "Ada", false), "Ada is running");
		assert.equal(agentHeadline(agent({ connected: true, helperHere: true }), "Ada", false), "The helper is running");
	});

	it("the teacher's tile: teaching, running and not started, starting, or not running with a button", () => {
		const teaching = agent({ connected: true, teaching: true });
		assert.deepEqual(teacherTile(teaching, { text: "Teaching Graphs", working: true }, own), {
			tone: "on",
			chip: "Teaching",
			line: "Teaching Graphs",
			note: "Teaches and answers you",
			start: null,
		});
		assert.equal(teacherTile(teaching, { text: "Idle", working: false }, own).line, "Nothing to do right now");
		const running = teacherTile(agent({ connected: true, name: "Codex" }), null, own);
		assert.equal(running.chip, "Running");
		assert.equal(running.line, "Tell Codex to start teaching.");
		assert.deepEqual(teacherTile(agent(), null, own), { tone: "off", chip: "Not running", line: "", note: "Start it and it teaches you", start: "Start teacher" });
		assert.deepEqual(teacherTile(agent(), null, { outside: false, term: "starting" }), { tone: "off", chip: "Starting", line: "", note: "Teaches and answers you", start: null });
		assert.equal(teacherTile(agent(), null, { outside: false, term: "ended" }).chip, "Stopped");
		assert.equal(teacherTile(agent({ pendingTurns: 1 }), null, own).line, "Your lesson is waiting");
		assert.equal(teacherTile(agent({ connected: true, teaching: true }), null, { outside: true, term: null }).note, "Connected from outside godspeed.");
	});

	it("a helper alone does not count as the teacher running", () => {
		assert.equal(teacherTile(agent({ connected: true, helperHere: true }), null, own).chip, "Not running");
	});

	it("when godspeed starts the helper by itself, its tile has no button until it ended", () => {
		assert.deepEqual(helper({ autoStart: true }), { tone: "off", chip: "Not running", line: "", note: "Starts by itself when there is reading to do", start: null });
		assert.equal(helper({ autoStart: true, filesLeft: 3 }).line, "3 files are waiting");
		assert.equal(helper({ autoStart: true, term: "starting" }).chip, "Starting");
		assert.equal(helper({ autoStart: true, term: "starting" }).start, null);
		const ended = helper({ autoStart: true, term: "ended" });
		assert.equal(ended.chip, "Stopped");
		assert.equal(ended.start, "Start again");
	});

	it("when godspeed can't start the helper, its tile says what waits and who reads meanwhile", () => {
		assert.deepEqual(helper(), { tone: "off", chip: "Not running", line: "", note: "Reads your files so the teacher stays free", start: "Start helper" });
		const waiting = helper({ filesLeft: 3 });
		assert.equal(waiting.line, "3 files are waiting");
		assert.equal(waiting.note, "Start it and it reads them");
		assert.equal(helper({ filesLeft: 1 }).line, "1 file is waiting");
		assert.equal(helper({ agent: agent({ connected: true, teaching: true }), filesLeft: 3 }).note, "Teacher does the reading between your messages");
	});

	it("the helper's tile while it runs: idle, reading, another job, or covering", () => {
		const here = agent({ connected: true, teaching: true, helperHere: true });
		assert.deepEqual(helper({ agent: here }), { tone: "on", chip: "Running", line: "Nothing to do right now", note: "It starts by itself when you add files", start: null });
		assert.deepEqual(helper({ agent: here, background: { text: "Reading week3.pdf", count: "part 2 of 5" }, files: "6 of 17 files in CSE 21", filesLeft: 11 }), {
			tone: "busy",
			chip: "Reading",
			line: "Reading week3.pdf, part 2 of 5",
			note: "6 of 17 files in CSE 21",
			start: null,
		});
		const job = helper({ agent: here, background: { text: "Making a cheat sheet" } });
		assert.equal(job.chip, "Working");
		assert.equal(job.note, "Does the background work");
		assert.deepEqual(helper({ agent: { ...here, helperCovering: true }, teacher: "Ada" }), {
			tone: "busy",
			chip: "Covering",
			line: "Answering for Ada for a minute",
			note: "Ada is tidying its memory",
			start: null,
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
