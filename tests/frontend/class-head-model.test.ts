import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classTabs, sheetCount } from "../../src/frontend/components/class-page/class-head-model.ts";

describe("a class's tabs", () => {
	it("Progress, Lessons, Files, Graph, Cheat sheets, Deadlines", () => {
		assert.deepEqual(classTabs(true).map((t) => [t.label, t.href]), [
			["Progress", "/class"],
			["Lessons", "/class/lessons"],
			["Files", "/class/files"],
			["Graph", "/graph"],
			["Cheat sheets", "/class/cheat-sheets"],
			["Deadlines", "/class/deadlines"],
		]);
	});
	it("lessons with no class have no files, cheat sheets or deadlines", () => {
		assert.deepEqual(classTabs(false).map((t) => t.label), ["Progress", "Lessons", "Graph"]);
	});
	it("Lessons, Files, Cheat sheets and Deadlines show a count", () => {
		assert.deepEqual(classTabs(true).map((t) => t.count), [undefined, "lessons", "files", undefined, "sheets", "deadlines"]);
	});
	it("the cheat sheet count leaves out deadlines with no sheet", () => {
		assert.equal(sheetCount([{ status: "made" }, { status: "none" }, { status: "making" }, { status: "older" }, { status: "newer" }]), 4);
	});
});
