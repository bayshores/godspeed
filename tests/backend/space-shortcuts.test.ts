/**
 * The godspeed folder's spaces/: where each space file's shortcut goes
 * (names safe everywhere, one name twice gets " (2)"), and the sync on disk:
 * shortcuts follow the spaces, a learner's own files stay, copies become
 * read-only and can still be removed or replaced, and paths inside spaces/
 * can't be added back.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lh-shortcuts-"));
const originalEnv = process.env;
process.env = {
	...(originalEnv.NODE_TEST_CONTEXT ? { NODE_TEST_CONTEXT: originalEnv.NODE_TEST_CONTEXT } : {}),
	...(originalEnv.NODE_OPTIONS ? { NODE_OPTIONS: originalEnv.NODE_OPTIONS } : {}),
	NODE_ENV: "test",
	LH_DATA_DIR: path.join(scratch, "data"),
	HOME: path.join(scratch, "home"),
	CLAUDE_CONFIG_DIR: path.join(scratch, "claude"),
	CODEX_HOME: path.join(scratch, "codex"),
};
fs.mkdirSync(path.join(scratch, "home"), { recursive: true });
after(() => {
	process.env = originalEnv;
	fs.rmSync(scratch, { recursive: true, force: true });
});

const core = await import("../../src/shared/core/space-shortcuts.ts");
const { syncShortcuts } = await import("../../src/backend/server/space-shortcuts.ts");
const spaces = await import("../../src/backend/server/spaces.ts");
const { setUpAgentFolder, shortcutPathProblem } = await import("../../src/backend/server/agent-folder.ts");
type SpaceFile = import("../../src/shared/core/contracts.ts").SpaceFile;

const file = (id: string, name: string, kind: "study" | "info" = "study"): SpaceFile => ({
	id,
	origin: "copied",
	name,
	path: `${id}/${name}`,
	kind,
	contentFp: "",
	status: "ready",
	addedAt: "",
});

describe("where shortcuts go", () => {
	it("names are safe on every computer", () => {
		assert.equal(core.safeEntryName('a/b\\c:d*e?"f<g>h|i'), "a-b-c-d-e--f-g-h-i");
		assert.equal(core.safeEntryName("notes. "), "notes");
		assert.equal(core.safeEntryName("   "), "Untitled");
		assert.equal(core.safeEntryName("CON.txt"), "CON_.txt");
	});
	it("a name used twice gets (2), ignoring case", () => {
		const taken = new Set<string>();
		assert.equal(core.uniqueName("HW.pdf", taken), "HW.pdf");
		assert.equal(core.uniqueName("hw.pdf", taken), "hw (2).pdf");
		assert.equal(core.uniqueName("HW.pdf", taken), "HW (3).pdf");
	});
	it("spaces, then Files page groups; archived spaces in Archived; reserved names avoided", () => {
		const layout = core.shortcutLayout([
			{ id: "c1", name: "CSE 21", archived: false, files: [file("a", "Day1.pdf"), file("b", "Day2.pdf"), file("c", "syllabus.txt", "info")] },
			{ id: "c2", name: "Archived", archived: false, files: [file("d", "x.pdf")] },
			{ id: "c3", name: "CSE 21", archived: true, files: [file("e", "old.pdf")] },
		]);
		assert.deepEqual(
			layout.map((s) => s.at.join("/")),
			["CSE 21/Day/Day1.pdf", "CSE 21/Day/Day2.pdf", "CSE 21/Other/syllabus.txt", "Archived (2)/Other/x.pdf", "Archived/CSE 21/Other/old.pdf"],
		);
	});
	it("each space's folder by id, the same names the layout uses", () => {
		const dirs = core.spaceDirs([
			{ id: "c1", name: "CSE 21", archived: false },
			{ id: "c2", name: "CSE 21", archived: false },
			{ id: "c3", name: "CSE: 29", archived: true },
		]);
		assert.deepEqual([...dirs.values()], [["CSE 21"], ["CSE 21 (2)"], ["Archived", "CSE- 29"]]);
	});
	it("the note lists files that couldn't get a shortcut", () => {
		assert.doesNotMatch(core.readmeText([]), /couldn't/);
		assert.match(core.readmeText(["CSE 21/Day/Day1.pdf"]), /- CSE 21\/Day\/Day1\.pdf/);
		assert.doesNotMatch(core.readmeText(["x"]), /—/, "no em-dashes");
	});
});

describe("the spaces folder on disk", () => {
	const folder = path.join(scratch, "home", "godspeed");
	const root = path.join(folder, "spaces");
	const src = path.join(scratch, "src");
	fs.mkdirSync(src, { recursive: true });
	const source = (name: string, text = name) => {
		const p = path.join(src, name);
		fs.writeFileSync(p, text);
		return p;
	};
	const tree = () =>
		fs.existsSync(root)
			? (fs.readdirSync(root, { recursive: true }) as string[]).map((p) => p.split(path.sep).join("/")).sort()
			: [];

	const space = spaces.createSpace({ name: "CSE 21" });
	const day1 = spaces.addFileFromPath(space.id, source("Day1 intro.pdf"), "study");
	const day2 = spaces.addFileFromPath(space.id, source("Day2 sums.pdf"), "study");
	assert.ok(day1.ok && day2.ok);

	it("builds one shortcut per file, grouped, with the note", () => {
		syncShortcuts(folder);
		assert.deepEqual(tree(), ["CSE 21", "CSE 21/Day", "CSE 21/Day/Day1 intro.pdf", "CSE 21/Day/Day2 sums.pdf", "READ ME.txt"]);
		const link = path.join(root, "CSE 21", "Day", "Day1 intro.pdf");
		if (process.platform !== "win32") assert.ok(fs.lstatSync(link).isSymbolicLink());
		assert.equal(fs.readFileSync(link, "utf8"), "Day1 intro.pdf");
	});
	it("copies are read-only, and removing or replacing one still works", { skip: process.platform === "win32" }, () => {
		const record = spaces.getSpace(space.id)!;
		const real = path.join(scratch, "data", "spaces", space.id, "files", record.files[1]!.path);
		assert.equal(fs.statSync(real).mode & 0o222, 0, "no write bits");
		assert.ok(spaces.replaceCopiedFile(space.id, day2.ok ? day2.value.id : "", new TextEncoder().encode("new"), "study").ok);
		assert.equal(fs.readFileSync(real, "utf8"), "new");
		assert.ok(spaces.removeFile(space.id, day2.ok ? day2.value.id : "").ok);
		assert.equal(fs.existsSync(real), false);
	});
	it("follows removals, renames and archiving, and leaves the learner's own files alone", () => {
		fs.writeFileSync(path.join(root, "CSE 21", "my notes.txt"), "mine");
		syncShortcuts(folder);
		assert.ok(!tree().includes("CSE 21/Day/Day2 sums.pdf"), "a removed file's shortcut goes");
		spaces.updateSpace(space.id, { name: "Discrete Math" });
		syncShortcuts(folder);
		assert.ok(tree().includes("Discrete Math/Other/Day1 intro.pdf"));
		assert.ok(tree().includes("CSE 21/my notes.txt"), "the learner's file stays, so its folder does too");
		spaces.updateSpace(space.id, { archived: true });
		syncShortcuts(folder);
		assert.ok(tree().includes("Archived/Discrete Math/Other/Day1 intro.pdf"));
		assert.ok(!tree().some((p) => p.startsWith("Discrete Math")));
	});
	it("a deleted space's folder goes; with no spaces, only the learner's files stay", async () => {
		assert.ok((await spaces.deleteSpace(space.id)).ok);
		syncShortcuts(folder);
		assert.deepEqual(tree(), ["CSE 21", "CSE 21/my notes.txt"]);
	});
	it("a moved godspeed folder takes the shortcuts along", () => {
		const other = spaces.createSpace({ name: "CSE 29" });
		assert.ok(spaces.addFileFromPath(other.id, source("Lab1.pdf"), "info").ok);
		setUpAgentFolder(folder);
		assert.ok(fs.existsSync(path.join(root, "CSE 29", "Other", "Lab1.pdf")));
		const moved = path.join(scratch, "home", "elsewhere");
		setUpAgentFolder(moved);
		assert.ok(fs.existsSync(path.join(moved, "spaces", "CSE 29", "Other", "Lab1.pdf")));
		assert.equal(fs.existsSync(path.join(root, "CSE 29")), false, "the old folder's shortcuts are cleared");
		assert.ok(fs.existsSync(path.join(root, "CSE 21", "my notes.txt")), "and the learner's file is still there");
	});
	it("a file or folder inside spaces/ can't be added back", () => {
		const inside = path.join(scratch, "home", "elsewhere", "spaces", "CSE 29");
		assert.match(shortcutPathProblem(inside) ?? "", /shortcuts/);
		assert.match(shortcutPathProblem(path.join(inside, "Other", "Lab1.pdf")) ?? "", /shortcuts/);
		assert.equal(shortcutPathProblem(src), null);
	});
});
