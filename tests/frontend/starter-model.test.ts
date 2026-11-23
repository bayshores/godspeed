import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { everything, startersFor, takesLine, type IdeaFacts } from "../../src/frontend/components/terminal/starter-model.ts";
import type { TerminalFacts, TerminalRecord } from "../../src/frontend/components/terminal/terminal-model.ts";

const CSE = { id: "s1", name: "CSE 21", files: 3 };
const deadline = (id: string, name: string, kind: IdeaFacts["deadlines"][number]["kind"], date: string, spaceId = "s1") => ({ id, name, kind, date, spaceId });
const HW = deadline("hw 6", "HW 6", "homework", "2026-11-20");
const MIDTERM = deadline("mt", "Midterm 2", "exam", "2026-11-25");
const facts = (over: Partial<IdeaFacts> = {}): IdeaFacts => ({ path: "/", space: CSE, spaces: 1, gaps: [], deadlines: [MIDTERM, HW], notesFolder: false, ...over });
const on = (path: string, over: Partial<IdeaFacts> = {}) => startersFor(facts({ path, ...over }));

describe("the lines for a page", () => {
	it("a deadline's page names it and leaves out what the page has keys for", () => {
		assert.deepEqual(on("/space/deadline/hw%206"), ["Get me ready for HW 6", "What am I weakest at for HW 6?", "What's due?"]);
	});

	it("a space's pages name the space; the Graph leaves out what it shows", () => {
		assert.deepEqual(on("/space"), ["What should I study in CSE 21?", "What do I know in CSE 21?", "Find something in my files", "Teach me a new topic"]);
		assert.deepEqual(on("/space/files"), ["What should I study in CSE 21?", "What do I know in CSE 21?", "Teach me a new topic"], "Files has its own key for looking inside");
		assert.deepEqual(on("/space/deadline/done-one"), on("/space"), "a deadline no longer open is just a space page");
		assert.deepEqual(on("/graph"), ["What should I study in CSE 21?", "Find something in my files", "Teach me a new topic"]);
		assert.ok(!on("/space", { space: { ...CSE, files: 0 } }).includes("Find something in my files"), "no files to look in");
	});

	it("anywhere else the plain ones, and with no space yet the ones that start one", () => {
		assert.deepEqual(on("/"), ["What should I study?", "Teach me a new topic", "Add a deadline", "Find something in my files"]);
		assert.deepEqual(on("/settings"), on("/"));
		assert.deepEqual(on("/terminal-window"), on("/"), "the terminal window is on no page");
		assert.deepEqual(on("/space", { space: null }), ["What should I study?", "Teach me a new topic", "Add a deadline"], "no space picked");
		assert.deepEqual(on("/", { space: null, spaces: 0, deadlines: [] }), ["Set up a space from my files", "Teach me a new topic", "Build me a path to a goal"]);
	});

	it("an update line comes first on a space's page when that space looks out of date", () => {
		const gap = { gaps: [{ id: "s1", name: "CSE 21" }] };
		assert.deepEqual(on("/space", gap), ["Update CSE 21", "What should I study in CSE 21?", "What do I know in CSE 21?", "Find something in my files"], "the last one drops out");
		assert.equal(on("/space/files", gap)[0], "Update CSE 21");
		assert.equal(on("/space/deadline/hw%206", gap)[0], "Update CSE 21");
		assert.ok(!on("/space/deadlines", gap).includes("Update CSE 21"), "the Deadlines tab has its own key");
		assert.deepEqual(on("/space/deadlines", gap), on("/space/deadlines"));
		assert.deepEqual(on("/space", { gaps: [{ id: "s9", name: "CSE 29" }] }), on("/space"), "another space's gap is not this page's");
	});

	it("elsewhere the update line names the one space with a gap, or all of them", () => {
		assert.deepEqual(on("/", { gaps: [{ id: "s2", name: "CSE 29" }] }), ["Update CSE 29", "What should I study?", "Teach me a new topic", "Add a deadline"]);
		const two = [{ id: "s1", name: "CSE 21" }, { id: "s2", name: "CSE 29" }];
		assert.equal(on("/", { gaps: two })[0], "Update my spaces");
		assert.equal(on("/graph", { gaps: two })[0], "Update my spaces");
		assert.equal(on("/space", { space: null, gaps: two })[0], "Update my spaces", "no space picked");
		assert.deepEqual(on("/chat/abc", { gaps: two }), [], "a lesson takes its own line");
	});

	it("none on a lesson or a cheat sheet, where a typed line goes to the page", () => {
		assert.deepEqual(on("/chat/abc"), []);
		assert.deepEqual(on("/space/deadline/hw%206/cheat-sheet"), []);
	});

	it("never more than four, and each one is sent as it reads", () => {
		for (const path of ["/", "/space", "/graph", "/space/deadline/mt", "/settings"]) assert.ok(on(path).length <= 4, path);
	});
});

describe("everything the teacher can be asked", () => {
	const lines = (f: IdeaFacts) => everything(f).flatMap((g) => g.ideas);
	const idea = (f: IdeaFacts, start: string) => lines(f).find((i) => i.line.startsWith(start));

	it("is grouped, and carries the learner's own names", () => {
		assert.deepEqual(everything(facts()).map((g) => g.name), ["Learn", "Deadlines", "Spaces and files", "About you"]);
		assert.deepEqual(idea(facts(), "Get me ready"), { line: "Get me ready for HW 6", needs: null }, "the soonest deadline");
		assert.deepEqual(idea(facts(), "Help me with"), { line: "Help me with HW 6", needs: null });
		assert.deepEqual(idea(facts(), "Make a cheat sheet"), { line: "Make a cheat sheet for HW 6", needs: null });
		assert.deepEqual(idea(facts(), "Write a mock exam"), { line: "Write a mock exam for Midterm 2", needs: null });
		assert.deepEqual(idea(facts(), "What do I know"), { line: "What do I know in CSE 21?", needs: null });
	});

	it("a job that cannot work yet says what it needs", () => {
		const bare = facts({ space: null, spaces: 0, deadlines: [] });
		assert.deepEqual(idea(bare, "Get me ready"), { line: "Get me ready for a deadline", needs: "needs a deadline" });
		assert.deepEqual(idea(bare, "Help me with"), { line: "Help me with my homework", needs: "needs a homework deadline" });
		assert.deepEqual(idea(bare, "Make a cheat sheet"), { line: "Make a cheat sheet", needs: "needs a deadline" });
		assert.deepEqual(idea(bare, "Write a mock exam"), { line: "Write a mock exam", needs: "needs an exam or quiz deadline" });
		assert.deepEqual(idea(bare, "Add a deadline"), { line: "Add a deadline", needs: "needs a space" });
		assert.deepEqual(idea(bare, "Find something"), { line: "Find something in my files", needs: "needs files in a space" });
		assert.deepEqual(idea(bare, "What do I know"), { line: "What do I know?", needs: "needs a space" });
		assert.equal(idea(bare, "Teach me")?.needs, null);
		assert.equal(idea(facts(), "Draw it")?.needs, "needs an open lesson");
	});

	it("Note this waits for a notes folder", () => {
		assert.deepEqual(idea(facts(), "Note this"), { line: "Note this", needs: "needs Obsidian or a notes folder" });
		assert.deepEqual(idea(facts({ notesFolder: true }), "Note this"), { line: "Note this", needs: null });
	});

	it("a deadline's kind decides its jobs: no mock for homework, no cheat sheet for an interview", () => {
		assert.equal(idea(facts({ deadlines: [HW] }), "Write a mock exam")?.needs, "needs an exam or quiz deadline");
		const interview = facts({ deadlines: [deadline("iv", "Onsite", "interview", "2026-11-21")] });
		assert.equal(idea(interview, "Make a cheat sheet")?.needs, "needs a deadline");
		assert.equal(idea(interview, "Write a mock exam")?.line, "Write a mock exam for Onsite");
	});

	it("names the active space's deadlines, and every space's with none active", () => {
		const other = deadline("o", "Essay", "project", "2026-11-19", "s2");
		assert.equal(idea(facts({ deadlines: [other, HW] }), "Get me ready")?.line, "Get me ready for HW 6");
		assert.equal(idea(facts({ space: null, deadlines: [other, HW] }), "Get me ready")?.line, "Get me ready for Essay");
	});

	it("Spaces and files always holds the update line: one space's on its page, all spaces' elsewhere", () => {
		const group = (f: IdeaFacts) => everything(f).find((g) => g.name === "Spaces and files")!.ideas.map((i) => i.line);
		assert.deepEqual(group(facts({ path: "/space" })), ["Update CSE 21", "Set up a space from my files", "Find something in my files"]);
		assert.deepEqual(group(facts({ path: "/space/deadlines" }))[0], "Update CSE 21");
		assert.deepEqual(group(facts({ path: "/" }))[0], "Update my spaces");
		assert.deepEqual(group(facts({ path: "/space", space: null }))[0], "Update my spaces");
		assert.deepEqual(group(facts({ space: null, spaces: 0, deadlines: [] })), ["Set up a space from my files", "Find something in my files"], "no space to update");
	});

	it("no line twice", () => {
		for (const f of [facts(), facts({ path: "/space" }), facts({ space: null, spaces: 0, deadlines: [] })]) {
			const all = lines(f).map((i) => i.line);
			assert.equal(new Set(all).size, all.length);
		}
	});
});

describe("when a terminal takes a line", () => {
	const term = (over: Partial<TerminalRecord> = {}): TerminalRecord => ({ id: "t1", role: "teacher", agent: "claude", startedAt: 1, ended: null, prompt: null, url: false, ...over });
	const now = (over: Partial<TerminalFacts> = {}, t: Partial<TerminalRecord> = {}): TerminalFacts => ({ term: term(t), checkedIn: true, outsideHere: false, teaching: true, now: 2, quietSince: null, helperBusy: false, turnWaits: false, ...over });

	it("running and checked in, with nothing asked", () => {
		assert.ok(takesLine(now()));
	});

	it("not before the check-in, while the screen asks, while a turn waits or after the end", () => {
		assert.ok(!takesLine(null));
		assert.ok(!takesLine(now({ checkedIn: false })));
		assert.ok(!takesLine(now({}, { prompt: "menu" })));
		assert.ok(!takesLine(now({}, { url: true })), "a sign-in link");
		assert.ok(!takesLine(now({ turnWaits: true })));
		assert.ok(!takesLine(now({}, { ended: { stopped: true, code: null } })));
	});
});
