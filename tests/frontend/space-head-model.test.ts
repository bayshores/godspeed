import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { headSignatureScale, sheetCount, spaceTabs, studiedShare, tabCount } from "../../src/frontend/components/space-page/space-head-model.ts";

describe("a space's tabs", () => {
	it("Progress, Lessons, Files, Graph, Cheat sheets, Deadlines", () => {
		assert.deepEqual(spaceTabs("space").map((t) => [t.label, t.href]), [
			["Progress", "/space"],
			["Lessons", "/space/lessons"],
			["Files", "/space/files"],
			["Graph", "/graph"],
			["Cheat sheets", "/space/cheat-sheets"],
			["Deadlines", "/space/deadlines"],
		]);
	});
	it("lessons with no space have no files, cheat sheets or deadlines", () => {
		assert.deepEqual(spaceTabs("none").map((t) => t.label), ["Progress", "Lessons", "Graph"]);
	});
	it("Progress, Lessons, Files, Cheat sheets and Deadlines show a count", () => {
		assert.deepEqual(spaceTabs("space").map((t) => t.count), ["studied", "lessons", "files", undefined, "sheets", "deadlines"]);
	});
	it("a count reads as its number, the studied share as a percent, and nothing until it has loaded", () => {
		const [progress, lessons, , graph] = spaceTabs("space");
		const counts = { studied: 19, lessons: 0, files: 3, sheets: 1, deadlines: 2 };
		assert.equal(tabCount(progress!, counts), "19%");
		assert.equal(tabCount(lessons!, counts), "0");
		assert.equal(tabCount(graph!, counts), undefined);
		assert.equal(tabCount(progress!, { ...counts, studied: undefined }), undefined);
	});
	it("the share of facts studied: in a lesson or answered, none with no facts", () => {
		const fact = (inLessons: boolean, answered = false) => ({ inLessons, answers: answered ? [{ chatId: "c", toolCallId: "t", outcome: "right" as const, answeredAt: "" }] : [] });
		assert.equal(studiedShare([fact(true), fact(false, true), fact(false), fact(false)]), 0.5);
		assert.equal(studiedShare([]), null);
	});
	it("the signature keeps its size when it fits, shrinks a long or tall one, and is left out before the name is cut", () => {
		assert.equal(headSignatureScale({ width: 200, height: 60 }, 600), 1);
		assert.equal(headSignatureScale({ width: 640, height: 60 }, 600), 0.5, "320 wide at most");
		assert.equal(headSignatureScale({ width: 200, height: 128 }, 600), 0.5, "64 tall at most");
		assert.equal(headSignatureScale({ width: 400, height: 60 }, 300), 0.75, "the room the name leaves");
		assert.equal(headSignatureScale({ width: 400, height: 60 }, 150), null, "too small to read");
		assert.equal(headSignatureScale({ width: 400, height: 60 }, 0), null, "no room at all");
		assert.equal(headSignatureScale({ width: 0, height: 0 }, 600), 1, "not measured yet");
	});
	it("the cheat sheet count leaves out deadlines with no sheet", () => {
		assert.equal(sheetCount([{ status: "made" }, { status: "none" }, { status: "making" }, { status: "older" }, { status: "newer" }]), 4);
	});
});
