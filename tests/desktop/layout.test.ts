import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evalLine, fill, findingLine, readAnswer, snapName, stableFindings } from "../../scripts/layout.mjs";
import { cross, cutOf, inkOf, lineBox, meet, sticksOut } from "../../scripts/layout-page.mjs";
import { workOf } from "../../scripts/layout-seed.mjs";
import { SCREENS } from "../../scripts/layout-screens.mjs";

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

describe("the page check's boxes", () => {
	it("meet is the shared part, or null when two boxes only touch", () => {
		assert.deepEqual(meet(box(0, 0, 10, 10), box(5, 5, 20, 20)), box(5, 5, 10, 10));
		assert.equal(meet(box(0, 0, 10, 10), box(10, 0, 20, 10)), null);
	});

	it("two boxes cross only by more than 2 pixels both ways", () => {
		assert.ok(cross(box(0, 0, 100, 20), box(50, 10, 150, 30)));
		assert.ok(!cross(box(0, 0, 100, 20), box(50, 18, 150, 38)), "2 pixels down is rounding");
		assert.ok(!cross(box(0, 0, 100, 20), box(98, 0, 150, 20)), "2 pixels across is rounding");
	});

	it("a child sticks out by more than 2 pixels above or below", () => {
		const parent = box(0, 100, 100, 200);
		assert.ok(sticksOut(box(0, 150, 100, 230), parent));
		assert.ok(sticksOut(box(0, 90, 100, 150), parent));
		assert.ok(!sticksOut(box(0, 99, 100, 202), parent));
		assert.ok(!sticksOut(box(-50, 120, 300, 180), parent), "sideways is the sideways check's");
	});

	it("a text box taller than its line height is cut to it around its middle", () => {
		assert.deepEqual(lineBox(box(0, 0, 50, 40), 20), box(0, 10, 50, 30));
		assert.deepEqual(lineBox(box(0, 0, 50, 20), 30), box(0, 0, 50, 20));
		assert.deepEqual(lineBox(box(0, 0, 50, 20), Number.NaN), box(0, 0, 50, 20), "line-height: normal");
	});
});

describe("cut-off letters", () => {
	// The space title as measured in the real window: 38 px Zen Kaku Gothic New in a 46 px box.
	const metrics = { fontBoundingBoxAscent: 44, actualBoundingBoxAscent: 27.4, actualBoundingBoxDescent: 8.2 };
	const text = box(0, 92.5, 200, 147.5);

	it("puts the baseline the font's ascent below the text box and the ink around it", () => {
		const ink = inkOf(text, metrics);
		assert.ok(Math.abs(ink.top - 109.1) < 0.01 && Math.abs(ink.bottom - 144.7) < 0.01, JSON.stringify(ink));
	});

	it("counts whole pixels the clip cuts off, and nothing under 1 px", () => {
		assert.deepEqual(cutOf(inkOf(text, metrics), box(0, 97.2, 200, 143.2)), { top: 0, bottom: 2 });
		assert.deepEqual(cutOf(inkOf(text, metrics), box(0, 97.2, 200, 144)), { top: 0, bottom: 0 });
		assert.deepEqual(cutOf({ top: 10, bottom: 20 }, box(0, 12, 50, 30)), { top: 2, bottom: 0 });
	});
});

describe("the channel", () => {
	it("an answer is ok, a JSON value or an error", () => {
		assert.equal(readAnswer("ok"), "ok");
		assert.deepEqual(readAnswer('[{"check":"spill"}]'), [{ check: "spill" }]);
		assert.equal(readAnswer("null"), null);
		const err = readAnswer("error: the script did not answer");
		assert.ok(err instanceof Error && err.message === "the script did not answer");
	});

	it("a script with line breaks and quotes goes as one eval line", () => {
		const line = evalLine('a = "x";\nb');
		assert.ok(!line.includes("\n"));
		assert.equal(line, 'eval (0, eval)("a = \\"x\\";\\nb")');
	});
});

describe("the walk", () => {
	it("keeps only findings seen in both reads", () => {
		const a = { check: "overlap", what: "a and b" };
		const b = { check: "spill", what: "c sticks out of d" };
		assert.deepEqual(stableFindings([a, b], [b]), [b]);
		assert.deepEqual(stableFindings([a], [b]), []);
	});

	it("fills the made-up data's ids into an address and refuses a missing one", () => {
		assert.equal(fill("/space/deadline/{deadline}", { deadline: "ddl_1" }), "/space/deadline/ddl_1");
		assert.throws(() => fill("/chat/{lesson}", {}), /no lesson id/);
	});

	it("names a finding and its picture by screen and width", () => {
		assert.equal(findingLine("Talk", 800, { check: "overlap", what: "a and b" }), "Talk at 800: overlap: a and b");
		assert.equal(snapName("Settings, General", 1100), "settings-general-1100.png");
	});

	it("every screen has a name, an address and a selector to wait for", () => {
		const names = new Set<string>();
		for (const screen of SCREENS) {
			assert.ok(screen.name && screen.url.startsWith("/") && screen.ready, JSON.stringify(screen));
			assert.ok(!names.has(screen.name), `${screen.name} twice`);
			names.add(screen.name);
		}
	});
});

describe("the stand-in agent", () => {
	it("reads what a work item is for off its text, even when cut", () => {
		const text = '{"status":"work","workId":"work_1","lessonId":"chat_talk","lessonTitle":"Talk","kind":"talk","tools":[{"name":"x"';
		assert.deepEqual(workOf(text), { lessonId: "chat_talk", task: undefined });
		assert.equal(workOf('{"status":"work","workId":"w","kind":"background task","task":"Graph extraction: a.md"}').task, "Graph extraction: a.md");
	});
});
