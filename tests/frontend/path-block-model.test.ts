/** The Path block on Progress: its title, the topic Study takes, the next three and Show all. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PathProgress, PathTopicProgress } from "../../src/shared/core/index.ts";
import { pathNext } from "../../src/shared/core/index.ts";
import { pathBlockView } from "../../src/frontend/components/overview/path-block-model.ts";

function topic(n: number, status: PathTopicProgress["status"]): PathTopicProgress {
	return { id: `p${n}`, name: `T${n}`, covers: "c", answered: 0, right: 0, wrong: 0, dontKnow: 0, rate: null, status, color: "" };
}

function path(statuses: PathTopicProgress["status"][], next: number): PathProgress {
	return { goal: "backend developer", topics: statuses.map((s, i) => topic(i + 1, s)), nextId: `p${next}` };
}

const names = (topics: readonly PathTopicProgress[]) => topics.map((t) => t.name);

describe("pathBlockView", () => {
	it("the place of the topic Study takes, then the next three, with the rest behind Show all", () => {
		const view = pathBlockView(path(["strong", "untested", "untested", "untested", "untested", "untested"], 2), false);
		assert.equal(view.title, "Path to backend developer");
		assert.equal(view.count, "2 of 6");
		assert.equal(view.next?.name, "T2");
		assert.deepEqual(names(view.rows), ["T3", "T4", "T5"]);
		assert.equal(view.showAll, 6);
		const all = pathBlockView(path(["strong", "untested", "untested", "untested", "untested", "untested"], 2), true);
		assert.deepEqual(names(all.rows), ["T1", "T3", "T4", "T5", "T6"], "every other topic, in order");
		assert.equal(all.showAll, null);
	});

	it("nothing left out: no Show all; the last topic has no next three", () => {
		assert.equal(pathBlockView(path(["untested", "untested"], 1), false).showAll, null);
		const last = pathBlockView(path(["weak", "weak"], 2), false);
		assert.deepEqual(names(last.rows), []);
		assert.equal(last.showAll, 2);
	});

	it("every topic strong: no place beside the title", () => {
		const view = pathBlockView(path(["strong", "strong"], 1), false);
		assert.equal(view.title, "Path to backend developer");
		assert.equal(view.count, null);
		assert.ok(view.allStrong);
	});

	it("pathNext is the topic and its place, or null for an id the path lacks", () => {
		assert.deepEqual(pathNext(path(["untested", "untested"], 2)), { topic: topic(2, "untested"), position: 2 });
		assert.equal(pathNext(path(["untested"], 9)), null);
	});
});
