/**
 * The Files page's Recent changes: added and removed files of the last 14
 * days, newest first, without the files that came with linking the
 * folder; and the summary's "2 removed".
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClassFile } from "../../src/shared/core/contracts.ts";
import { changeDay, recentChanges, removedLately } from "../../src/frontend/components/files/recent-changes-model.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-06T18:00:00.000Z");
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();
const file = (id: string, extra: Partial<ClassFile>): ClassFile => ({
	id,
	origin: "linked",
	name: `${id}.pdf`,
	path: `${id}.pdf`,
	kind: "study",
	contentFp: "",
	status: "ready",
	addedAt: ago(1),
	...extra,
});

describe("recent changes", () => {
	it("lists found, hand-added and removed files newest first, not linked or old ones", () => {
		const files = [
			file("linked", { addedAt: ago(1) }),
			file("found", { foundByScan: true, addedAt: ago(2) }),
			file("copied", { origin: "copied", addedAt: ago(0.5) }),
			file("old", { foundByScan: true, addedAt: ago(15) }),
		];
		const removed = [{ id: "gone", name: "gone.pdf", at: ago(1.5) }];
		assert.deepEqual(
			recentChanges(files, removed, NOW).map((c) => `${c.change}:${c.id}`),
			["added:copied", "removed:gone", "added:found"],
		);
	});

	it("counts files removed in the last few days", () => {
		assert.equal(removedLately([{ id: "a", name: "a", at: ago(1) }, { id: "b", name: "b", at: ago(2) }, { id: "c", name: "c", at: ago(5) }], NOW), "2 removed");
		assert.equal(removedLately([], NOW), null);
	});

	it("gives a change's local day", () => {
		const at = new Date(2026, 10, 4, 23, 30).toISOString();
		assert.equal(changeDay(at), "2026-11-04");
	});
});
