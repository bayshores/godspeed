/**
 * data/classes when data/spaces is already there (a move that failed, or a
 * space made before it worked): each old space moves in on its own, one
 * that both folders have stays where it is, and the next start tries again.
 * The layout is laid down before the store loads.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it, mock } from "node:test";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-space-merge-"));
const DATA = path.join(TMP, "data");
process.env.LH_DATA_DIR = DATA;

const write = (rel: string, value: unknown) => {
	const file = path.join(DATA, rel);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
};
const record = (id: string, name: string) => ({
	id,
	name,
	description: "",
	createdAt: "2026-10-01T00:00:00.000Z",
	updatedAt: "2026-10-01T00:00:00.000Z",
	archived: false,
	files: [],
	color: 2,
});

write("spaces/spc_new1/space.json", record("spc_new1", "Made first"));
write("spaces/cls_both/space.json", record("cls_both", "Kept"));
write("classes/cls_both/class.json", record("cls_both", "Old copy"));
write("classes/cls_old1/class.json", record("cls_old1", "Old Space"));
write("classes/cls_old1/files/f1/notes.txt", "notes");

const errors = mock.method(console, "error", () => {});
const { spaceStore } = await import("../../src/backend/store/spaces.ts");

after(() => {
	mock.restoreAll();
	fs.rmSync(TMP, { recursive: true, force: true });
});

describe("data/classes beside data/spaces", () => {
	it("an old space moves in and reads like any other", () => {
		assert.equal(fs.readFileSync(path.join(DATA, "spaces", "cls_old1", "files", "f1", "notes.txt"), "utf8"), "notes");
		assert.equal(fs.existsSync(path.join(DATA, "classes", "cls_old1")), false);
		assert.equal(spaceStore.getSpace("cls_old1")?.name, "Old Space");
		assert.deepEqual(spaceStore.listSpaces().map((s) => s.id).sort(), ["cls_both", "cls_old1", "spc_new1"]);
	});

	it("a space both folders have is neither overwritten nor merged, and one line says how many stayed", () => {
		assert.equal(spaceStore.getSpace("cls_both")?.name, "Kept");
		assert.equal(fs.existsSync(path.join(DATA, "spaces", "cls_both", "class.json")), false);
		assert.equal(JSON.parse(fs.readFileSync(path.join(DATA, "classes", "cls_both", "class.json"), "utf8")).name, "Old copy");
		const lines = errors.mock.calls.map((c) => c.arguments.join(" "));
		assert.equal(lines.length, 1);
		assert.match(lines[0]!, /1 entries stayed in data\/classes/);
		assert.doesNotMatch(lines[0]!, /Old copy|cls_both/);
	});

	it("the next start moves what can move now and removes data/classes once it is empty", async () => {
		fs.rmSync(path.join(DATA, "spaces", "cls_both"), { recursive: true });
		const nextStart = "../../src/backend/store/spaces.ts?next-start";
		await import(nextStart);
		assert.equal(fs.existsSync(path.join(DATA, "classes")), false);
		assert.equal(spaceStore.getSpace("cls_both")?.name, "Old copy");
	});
});
