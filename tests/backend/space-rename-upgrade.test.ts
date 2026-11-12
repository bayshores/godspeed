/**
 * Data saved while spaces were still called classes is read under its old
 * names and written under the new ones: the data folder, the record file,
 * the space id on lessons, activity, notes and rules, the open space in
 * settings, a saved prompt part, and the godspeed folder's shortcuts.
 * The old layout is laid down before any store loads.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-space-rename-"));
const DATA = path.join(TMP, "data");
process.env.LH_DATA_DIR = DATA;

const OLD_ID = "cls_old1";
const write = (rel: string, value: unknown) => {
	const file = path.join(DATA, rel);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
};
const readJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(DATA, rel), "utf8"));

write(`classes/${OLD_ID}/class.json`, {
	id: OLD_ID,
	name: "Old Space",
	description: "",
	createdAt: "2026-10-01T00:00:00.000Z",
	updatedAt: "2026-10-01T00:00:00.000Z",
	archived: false,
	files: [{ id: "f1", origin: "copied", name: "notes.txt", path: "f1/notes.txt", kind: "study", contentFp: "", status: "ready", addedAt: "2026-10-01T00:00:00.000Z" }],
	color: 3,
	version: 8,
});
write(`classes/${OLD_ID}/files/f1/notes.txt`, "notes");
write("chats/chat_old1.json", {
	id: "chat_old1",
	title: "Old lesson",
	createdAt: "2026-10-02T00:00:00.000Z",
	updatedAt: "2026-10-02T00:00:00.000Z",
	classId: OLD_ID,
	messages: [
		{ role: "custom", customType: "class-context", content: "[Class context]", details: { classId: OLD_ID, name: "Old Space" } },
		{ role: "custom", customType: "app-request", content: "", details: { deadlines: [{ id: "ddl_1", name: "Quiz", className: "Old Space" }] } },
	],
	version: 1,
});
write("settings.json", { version: 2, general: { activeClass: OLD_ID, sounds: false } });
write("agent-actions.json", {
	version: 1,
	actions: [{ id: "a1", at: "2026-10-03T00:00:00.000Z", agent: "claude", label: "Linking Notes", classId: OLD_ID, target: { kind: "class", id: OLD_ID }, page: "/class/files" }],
});
write("agent-notes.json", { version: 1, notes: [{ id: "note_1", text: "Likes worked examples", classId: OLD_ID, createdAt: "2026-10-03T00:00:00.000Z" }] });
write("agent-rules.json", { version: 1, rules: [{ where: { classId: OLD_ID }, text: "Use the book's notation", at: "2026-10-03T00:00:00.000Z" }] });
write("prompts/shared/12-class-context.md", "my own wording");

const { spaceStore } = await import("../../src/backend/store/spaces.ts");
const { chatStore } = await import("../../src/backend/store/chats.ts");
const { readSettings } = await import("../../src/backend/store/settings.ts");
const { readAgentActions } = await import("../../src/backend/store/agent-actions.ts");
const { listAgentNotes } = await import("../../src/backend/store/agent-notes.ts");
const { readSavedRules } = await import("../../src/backend/store/agent-rules.ts");
const { promptOverrides } = await import("../../src/backend/store/prompt-overrides.ts");
const { syncShortcuts } = await import("../../src/backend/server/space-shortcuts.ts");

after(() => {
	fs.rmSync(TMP, { recursive: true, force: true });
});

describe("data from before the rename", () => {
	it("the classes folder becomes spaces, with everything in it", () => {
		assert.equal(fs.existsSync(path.join(DATA, "classes")), false);
		assert.equal(fs.readFileSync(path.join(DATA, "spaces", OLD_ID, "files", "f1", "notes.txt"), "utf8"), "notes");
	});

	it("class.json is read, and the next save writes space.json in its place", () => {
		const space = spaceStore.getSpace(OLD_ID);
		assert.equal(space?.name, "Old Space");
		assert.equal(space?.files.length, 1);
		assert.deepEqual(spaceStore.listSpaces().map((s) => s.id), [OLD_ID]);
		assert.ok(fs.existsSync(path.join(DATA, "spaces", OLD_ID, "class.json")), "a read alone rewrites nothing");

		spaceStore.updateSpace(OLD_ID, { description: "still here" });
		assert.equal(fs.existsSync(path.join(DATA, "spaces", OLD_ID, "class.json")), false);
		const saved = readJson(`spaces/${OLD_ID}/space.json`);
		assert.equal(saved.version, 9);
		assert.equal(saved.files.length, 1);
		assert.equal(spaceStore.getSpace(OLD_ID)?.description, "still here");
	});

	it("an old id stays valid and a new space gets the new prefix", () => {
		assert.match(spaceStore.createSpace({ name: "New" }).id, /^spc_/);
		assert.ok(spaceStore.getSpace(OLD_ID));
	});

	it("a lesson keeps its space, its space card and its deadline request", () => {
		const chat = chatStore.getChat("chat_old1")!;
		assert.equal(chat.spaceId, OLD_ID);
		assert.equal("classId" in chat, false);
		const [card, request] = chat.messages as unknown as { customType: string; details: Record<string, unknown> }[];
		assert.equal(card!.customType, "space-context");
		assert.deepEqual(card!.details, { name: "Old Space", spaceId: OLD_ID });
		assert.deepEqual(request!.details.deadlines, [{ id: "ddl_1", name: "Quiz", spaceName: "Old Space" }]);
		assert.equal(chatStore.listChats().find((c) => c.id === "chat_old1")?.spaceId, OLD_ID);

		chatStore.renameChat("chat_old1", "Renamed");
		const saved = readJson("chats/chat_old1.json");
		assert.equal(saved.version, 2);
		assert.equal(saved.spaceId, OLD_ID);
		assert.equal("classId" in saved, false);
		assert.equal(saved.messages[0].customType, "space-context");
	});

	it("settings keep the open space", () => {
		const settings = readSettings();
		assert.equal(settings?.general?.activeSpace, OLD_ID);
		assert.equal(settings?.general?.sounds, false);
		const saved = readJson("settings.json");
		assert.equal(saved.version, 3);
		assert.equal(saved.general.activeSpace, OLD_ID);
		assert.equal("activeClass" in saved.general, false);
	});

	it("recent changes keep their space, their target and a page that still exists", () => {
		assert.deepEqual(readAgentActions(), [
			{ id: "a1", at: "2026-10-03T00:00:00.000Z", agent: "claude", label: "Linking Notes", spaceId: OLD_ID, target: { kind: "space", id: OLD_ID }, page: "/space/files" },
		]);
	});

	it("notes and saved rules keep their space", () => {
		assert.equal(listAgentNotes()[0]?.spaceId, OLD_ID);
		assert.deepEqual(readSavedRules()[0]?.where, { spaceId: OLD_ID });
	});

	it("a saved space context prompt part is still in use", () => {
		assert.equal(promptOverrides.readOverride("shared/12-space-context.md"), "my own wording");
		assert.deepEqual(promptOverrides.listOverrides(), ["shared/12-space-context.md"]);
	});
});

describe("the godspeed folder from before the rename", () => {
	const real = path.join(DATA, "spaces", OLD_ID, "files", "f1", "notes.txt");
	/** A folder as the old sync left it: shortcuts and its note under classes/. */
	const oldFolder = (name: string) => {
		const folder = path.join(TMP, name);
		const dir = path.join(folder, "classes", "Old Space", "Other");
		fs.mkdirSync(dir, { recursive: true });
		fs.symlinkSync(real, path.join(dir, "notes.txt"), "file");
		fs.writeFileSync(path.join(folder, "classes", "READ ME.txt"), "old note");
		fs.mkdirSync(path.join(folder, ".godspeed"), { recursive: true });
		fs.writeFileSync(
			path.join(folder, ".godspeed", "shortcuts.json"),
			JSON.stringify({ links: [{ path: path.join(dir, "notes.txt"), target: real }], dirs: [path.join(folder, "classes"), path.dirname(dir), dir] }),
		);
		return folder;
	};
	const under = (dir: string) => (fs.readdirSync(dir, { recursive: true }) as string[]).map((p) => p.split(path.sep).join("/"));

	it("shortcuts move to spaces/ and the old classes/ folder goes", { skip: process.platform === "win32" }, () => {
		const folder = oldFolder("godspeed-a");
		syncShortcuts(folder);
		assert.equal(fs.existsSync(path.join(folder, "classes")), false);
		assert.ok(under(path.join(folder, "spaces")).some((p) => p.endsWith("/notes.txt")));
	});

	it("a file the learner put in classes/ stays", { skip: process.platform === "win32" }, () => {
		const folder = oldFolder("godspeed-b");
		fs.writeFileSync(path.join(folder, "classes", "Old Space", "mine.txt"), "mine");
		syncShortcuts(folder);
		assert.deepEqual(under(path.join(folder, "classes")).sort(), ["Old Space", "Old Space/mine.txt"]);
		syncShortcuts(folder);
		assert.equal(fs.readFileSync(path.join(folder, "classes", "Old Space", "mine.txt"), "utf8"), "mine");
	});

	/** Finder's file in classes/ and every folder under it. */
	const finderFiles = (folder: string) => {
		for (const dir of ["", "Old Space", "Old Space/Other"]) fs.writeFileSync(path.join(folder, "classes", dir, ".DS_Store"), "finder");
	};

	it("Finder's .DS_Store files don't keep classes/", { skip: process.platform === "win32" }, () => {
		const folder = oldFolder("godspeed-c");
		finderFiles(folder);
		syncShortcuts(folder);
		assert.equal(fs.existsSync(path.join(folder, "classes")), false);
	});

	it("a classes/ an earlier sync dropped from its list still goes when only Finder's files are in it", () => {
		const folder = path.join(TMP, "godspeed-d");
		fs.mkdirSync(path.join(folder, "classes", "Old Space", "Other"), { recursive: true });
		fs.mkdirSync(path.join(folder, "classes", "Empty"));
		finderFiles(folder);
		fs.mkdirSync(path.join(folder, ".godspeed"));
		fs.writeFileSync(path.join(folder, ".godspeed", "shortcuts.json"), JSON.stringify({ links: [], dirs: [] }));
		syncShortcuts(folder);
		assert.equal(fs.existsSync(path.join(folder, "classes")), false);
	});

	it("a learner's file keeps classes/ and the Finder files beside it as they are", { skip: process.platform === "win32" }, () => {
		const folder = oldFolder("godspeed-e");
		finderFiles(folder);
		fs.writeFileSync(path.join(folder, "classes", "Old Space", "mine.txt"), "mine");
		syncShortcuts(folder);
		syncShortcuts(folder);
		assert.deepEqual(under(path.join(folder, "classes")).sort(), [".DS_Store", "Old Space", "Old Space/.DS_Store", "Old Space/mine.txt"]);
	});
});
