/** Tests for writeFileAtomic (src/store/write-file-atomic.ts). */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { writeFileAtomic } from "../src/store/write-file-atomic.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-write-atomic-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("writeFileAtomic", () => {
	it("makes the folder, replaces the file and leaves no temp file", () => {
		const file = path.join(dir, "nested", "record.json");
		writeFileAtomic(file, "first");
		writeFileAtomic(file, "second");
		assert.equal(fs.readFileSync(file, "utf-8"), "second");
		assert.deepEqual(fs.readdirSync(path.dirname(file)), ["record.json"]);
	});

	it("keeps the old file and cleans up when the rename fails", () => {
		const target = path.join(dir, "taken");
		fs.mkdirSync(path.join(target, "inside"), { recursive: true });
		assert.throws(() => writeFileAtomic(target, "text"));
		assert.deepEqual(fs.readdirSync(dir).sort(), ["nested", "taken"]);
	});
});
