import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fitScale, sheetCount, spaceTabs, studiedShare, tabCount } from "../../src/frontend/components/space-page/space-head-model.ts";

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
	it("fitScale keeps a signature that fits, and shrinks a long or tall one to its room", () => {
		const room = { width: 320, height: 64 };
		assert.equal(fitScale({ width: 200, height: 30 }, room), 1);
		assert.equal(fitScale({ width: 640, height: 30 }, room), 0.5);
		assert.equal(fitScale({ width: 200, height: 128 }, room), 0.5);
		assert.equal(fitScale({ width: 0, height: 0 }, room), 1, "not measured yet");
	});
	it("the cheat sheet count leaves out deadlines with no sheet", () => {
		assert.equal(sheetCount([{ status: "made" }, { status: "none" }, { status: "making" }, { status: "older" }, { status: "newer" }]), 4);
	});
});
