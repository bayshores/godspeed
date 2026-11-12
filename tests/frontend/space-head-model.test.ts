import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spaceTabs, sheetCount } from "../../src/frontend/components/space-page/space-head-model.ts";

describe("a space's tabs", () => {
	it("Progress, Lessons, Files, Graph, Cheat sheets, Deadlines", () => {
		assert.deepEqual(spaceTabs(true).map((t) => [t.label, t.href]), [
			["Progress", "/space"],
			["Lessons", "/space/lessons"],
			["Files", "/space/files"],
			["Graph", "/graph"],
			["Cheat sheets", "/space/cheat-sheets"],
			["Deadlines", "/space/deadlines"],
		]);
	});
	it("lessons with no space have no files, cheat sheets or deadlines", () => {
		assert.deepEqual(spaceTabs(false).map((t) => t.label), ["Progress", "Lessons", "Graph"]);
	});
	it("Lessons, Files, Cheat sheets and Deadlines show a count", () => {
		assert.deepEqual(spaceTabs(true).map((t) => t.count), [undefined, "lessons", "files", undefined, "sheets", "deadlines"]);
	});
	it("the cheat sheet count leaves out deadlines with no sheet", () => {
		assert.equal(sheetCount([{ status: "made" }, { status: "none" }, { status: "making" }, { status: "older" }, { status: "newer" }]), 4);
	});
});
