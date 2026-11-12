/**
 * The mock store: one file per mock under its space, listed oldest first,
 * a broken file set aside. Runs under an isolated LH_DATA_DIR.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-mocks-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { listMocks, readMock, removeMock, writeMock } = await import("../../src/backend/store/mocks.ts");
const { newMock } = await import("../../src/shared/core/mock.ts");

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

const SPACE = "cls_test_0a1b2c3d";
const FORMAT = { questions: 4, minutes: 70 };

describe("the mock store", () => {
	it("saves, reads, lists oldest first and removes", () => {
		assert.deepEqual(listMocks(SPACE), []);
		const second = newMock("mock_00000002", 2, FORMAT, "2026-11-12T09:00:00.000Z");
		const first = newMock("mock_00000001", 1, FORMAT, "2026-11-11T09:00:00.000Z");
		writeMock(SPACE, second);
		writeMock(SPACE, first);
		assert.deepEqual(readMock(SPACE, first.id), first);
		assert.deepEqual(listMocks(SPACE).map((m) => m.n), [1, 2]);
		removeMock(SPACE, first.id);
		assert.equal(readMock(SPACE, first.id), null);
		assert.deepEqual(listMocks(SPACE).map((m) => m.n), [2]);
	});

	it("sets a broken file aside and refuses bad ids", () => {
		const file = path.join(TMP_DATA, "spaces", SPACE, "mocks", "mock_0000000a.json");
		fs.writeFileSync(file, "{ not json");
		assert.equal(readMock(SPACE, "mock_0000000a"), null);
		assert.equal(fs.existsSync(file), false, "kept aside under another name");
		assert.throws(() => readMock(SPACE, "../space"));
		assert.throws(() => listMocks("../.."));
	});
});
