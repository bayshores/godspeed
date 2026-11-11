import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classTabs } from "../../src/frontend/components/class-page/class-head-model.ts";

describe("a class's tabs", () => {
	it("Progress, Lessons, Files, Graph, Cheat sheets", () => {
		assert.deepEqual(classTabs(true).map((t) => [t.label, t.href]), [
			["Progress", "/class"],
			["Lessons", "/class/lessons"],
			["Files", "/class/files"],
			["Graph", "/graph"],
			["Cheat sheets", "/class/cheat-sheets"],
		]);
	});
	it("lessons with no class have no files or cheat sheets", () => {
		assert.deepEqual(classTabs(false).map((t) => t.label), ["Progress", "Lessons", "Graph"]);
	});
});
