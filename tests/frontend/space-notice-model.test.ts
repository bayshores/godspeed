import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addCheck, cardLines, changeHref, undoneWords, type SpaceCheck } from "../../src/frontend/components/space-notice-model.ts";

const check = (spaceId: string, run: string, lines: string[] = ["Added HW 5, due Fri Nov 20 11:59 PM"]): SpaceCheck => ({ run, spaceId, agent: "Claude Code", lines, said: null });

describe("addCheck", () => {
	it("replaces the card of the same space and keeps the others", () => {
		const first = [check("a", "r1"), check("b", "r2")];
		assert.deepEqual(addCheck(first, check("a", "r3")).map((c) => c.run), ["r2", "r3"]);
	});
});

describe("cardLines", () => {
	it("shows up to three lines and counts the rest", () => {
		assert.deepEqual(cardLines(["a", "b"]), { shown: ["a", "b"], more: 0 });
		assert.deepEqual(cardLines(["a", "b", "c", "d", "e"]), { shown: ["a", "b", "c"], more: 2 });
	});
});

describe("changeHref", () => {
	it("opens Deadlines for deadline lines and Progress for a path or description line", () => {
		assert.equal(changeHref(["Added HW 5, due Fri Nov 20", "Linked Week 7.pdf to Final"]), "/space/deadlines");
		assert.equal(changeHref(["Added 6 path topics"]), "/space");
		assert.equal(changeHref(["Linked Week 7.pdf to Final", "Updated the description"]), "/space");
	});
});

describe("undoneWords", () => {
	it("says Undone, and nothing more when everything went back", () => {
		assert.deepEqual(undoneWords({ undone: 2, changedSince: [], inUse: [] }), { title: "Undone", left: null });
	});
	it("names what was left as it is, once each", () => {
		assert.deepEqual(undoneWords({ undone: 1, changedSince: ["HW 5"], inUse: [] }), { title: "Undone", left: "Left HW 5 as it is." });
		assert.deepEqual(undoneWords({ undone: 1, changedSince: ["HW 5", "Final"], inUse: ["Final", "Quiz"] }).left, "Left HW 5, Final and Quiz as they are.");
	});
	it("says so when nothing went back", () => {
		assert.equal(undoneWords({ undone: 0, changedSince: ["HW 5"], inUse: [] }).title, "Nothing was undone");
		assert.equal(undoneWords(null).title, "Nothing was undone");
	});
});
