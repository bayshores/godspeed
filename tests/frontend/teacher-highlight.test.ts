/**
 * What the teacher changed stays lit: one style rule per mark, so a row drawn again keeps it.
 * A mark leaves when the pointer goes over it, on another page and with the next round,
 * fading out first.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dropLeft, letGo, lightUp, litRules, type Lit } from "../../src/frontend/components/teacher/lit-model.ts";

const none: Lit = new Map();
const plain = (s: string) => s;

describe("lit marks", () => {
	it("a burst leaves every changed thing lit, each with the page it was lit on", () => {
		const lit = lightUp(lightUp(none, ["deadline:a", "deadline:b"], "/space/deadlines"), ["file:f"], "/space/files");
		assert.deepEqual([...lit], [
			["deadline:a", { page: "/space/deadlines", leaving: false }],
			["deadline:b", { page: "/space/deadlines", leaving: false }],
			["file:f", { page: "/space/files", leaving: false }],
		]);
		assert.equal(lightUp(lit, [], "/"), lit, "nothing to light changes nothing");
	});

	it("the pointer over one lets only that one go, which fades and then is gone", () => {
		const lit = lightUp(none, ["deadline:a", "deadline:b"], "/");
		const over = letGo(lit, (key) => key !== "deadline:a");
		assert.deepEqual(over.get("deadline:a"), { page: "/", leaving: true });
		assert.deepEqual(over.get("deadline:b"), { page: "/", leaving: false });
		assert.equal(letGo(over, (key) => key !== "deadline:a"), over, "already leaving: nothing new");
		assert.deepEqual([...dropLeft(over).keys()], ["deadline:b"]);
		assert.equal(dropLeft(lit), lit, "nothing leaving: the same marks");
	});

	it("another page lets that page's marks go, and a new round lets all go", () => {
		const lit = lightUp(lightUp(none, ["deadline:a"], "/"), ["file:f"], "/space/files");
		const moved = letGo(lit, (_, mark) => mark.page === "/space/files");
		assert.deepEqual([...dropLeft(moved).keys()], ["file:f"]);
		assert.equal(dropLeft(letGo(lit, () => false)).size, 0);
	});

	it("lighting a leaving mark again keeps it", () => {
		const leaving = letGo(lightUp(none, ["deadline:a"], "/"), () => false);
		assert.deepEqual(lightUp(leaving, ["deadline:a"], "/").get("deadline:a"), { page: "/", leaving: false });
	});

	it("one rule per mark: lit ones tinted with an edge, fading in; leaving ones fading back, with motion only", () => {
		assert.equal(litRules(none, plain), "");
		const lit = letGo(lightUp(none, ["deadline:a", "file:f"], "/"), (key) => key !== "file:f");
		const css = litRules(lit, (v) => v.replace(":", "\\:"));
		const [rules, motion] = css.split("\n");
		assert.equal(rules, '[data-teacher-target="deadline\\:a"]{background-color:color-mix(in srgb, var(--lh-tint) 16%, var(--background))!important;box-shadow:inset 2px 0 0 var(--lh-tint)!important}');
		assert.match(motion ?? "", /^@media \(prefers-reduced-motion:no-preference\)\{\[data-teacher-target="deadline\\:a"\]\{transition:background-color var\(--lh-dur\)/);
		assert.match(motion ?? "", /\[data-teacher-target="file\\:f"\]\{transition:background-color var\(--lh-dur-fast\) var\(--lh-ease-in\)/);
		assert.ok(!(rules ?? "").includes("file"), "a leaving mark has no tint");
	});
});
