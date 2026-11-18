import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { evalLine, fill, findingLine, misfit, readAnswer, sameFindings, scrolledWords, SCROLL_TO, snapName, standInAgent } from "../../scripts/layout.mjs";
import { cross, cutOf, inkOf, lineBox, meet, offGap, outside, probes, scrollerClip, sticksOut } from "../../scripts/layout-page.mjs";
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

describe("spacing", () => {
	it("a gap between neighbouring sheets is off when it is not the shared one, and far apart is not neighbours", () => {
		assert.ok(!offGap(24, 24));
		assert.ok(!offGap(24.6, 24), "rounding");
		assert.ok(offGap(22, 24));
		assert.ok(offGap(32, 24));
		assert.ok(!offGap(48, 24), "columns that end at different heights");
	});
});

describe("covered", () => {
	it("tests nine points inside a box, 3 pixels in from its sides", () => {
		const points = probes(box(0, 0, 100, 40));
		assert.equal(points.length, 9);
		assert.deepEqual(points.slice(0, 3), [
			{ x: 3, y: 10 },
			{ x: 50, y: 10 },
			{ x: 97, y: 10 },
		]);
		assert.deepEqual(
			points.map((p) => p.y),
			[10, 10, 10, 20, 20, 20, 30, 30, 30],
		);
	});
});

describe("hidden", () => {
	const card = { ...box(0, 0, 200, 100), x: false, y: true };

	it("a box more than 2 pixels outside counts only along the axes the clip clips", () => {
		assert.ok(outside(box(10, 90, 80, 130), card), "a button pushed out of the bottom");
		assert.ok(outside(box(10, -20, 80, 0), card), "a line above the top");
		assert.ok(!outside(box(10, 80, 80, 102), card), "2 pixels is rounding");
		assert.ok(!outside(box(150, 10, 400, 30), card), "sideways is not clipped here");
		assert.ok(outside(box(150, 10, 400, 30), { ...card, x: true }));
	});

	it("a scroller hides for good only what lies before its start", () => {
		const page = scrollerClip(box(170, 100, 800, 700), { left: 0, top: 0 }, { x: true, y: true });
		assert.ok(outside(box(20, 150, 460, 400), page), "a pop-up that starts left of the page");
		assert.ok(!outside(box(200, 900, 400, 930), page), "a row below the fold is scrolled to");
		assert.ok(!outside(box(700, 150, 1100, 180), page), "so is one past the right edge");
		const scrolled = scrollerClip(box(170, 100, 800, 700), { left: 0, top: 300 }, { x: true, y: true });
		assert.ok(!outside(box(200, -150, 400, -120), scrolled), "a row scrolled away above comes back");
	});

	it("a scroller that only clips sideways hides both sides", () => {
		const column = scrollerClip(box(170, 100, 800, 700), { left: 0, top: 0 }, { x: false, y: true });
		assert.ok(outside(box(700, 150, 1100, 180), column), "past the right edge");
		assert.ok(!outside(box(200, 900, 400, 930), column), "below the fold is scrolled to");
	});
});

describe("cut-off letters", () => {
	// A 38 px space title in a 46 px box, with the metrics a real window gives such a title.
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
	it("two reads agree when they find the same things on the same elements, whatever the words", () => {
		const clock = { check: "overlap", key: "overlap 3 7", what: "clock \"19:02\" and b" };
		const spill = { check: "spill", key: "spill 4 5", what: "c sticks out of d" };
		assert.ok(sameFindings([clock, spill], [spill, { ...clock, what: "clock \"19:03\" and b" }]));
		assert.ok(!sameFindings([clock], [clock, spill]), "a finding drawn late");
		assert.ok(sameFindings([], []));
	});

	it("says why the window is not the size asked for", () => {
		assert.equal(misfit({ width: 1440, height: 900 }, { width: 1440, height: 900 }), null);
		assert.equal(misfit({ width: 1440, height: 900 }, { width: 1280, height: 900 }), "the window is 1280 by 900 points, not 1440 by 900");
	});

	it("fills the made-up data's ids into an address and refuses a missing one", () => {
		assert.equal(fill("/space/deadline/{deadline}", { deadline: "ddl_1" }), "/space/deadline/ddl_1");
		assert.throws(() => fill("/chat/{lesson}", {}), /no lesson id/);
	});

	it("names a finding and its picture by screen and width", () => {
		assert.equal(findingLine("Talk", 800, { check: "overlap", what: "a and b" }), "Talk at 800: overlap: a and b");
		assert.equal(snapName("Settings, General", 1100), "settings-general-1100.png");
	});

	it("checks each screen as it opens, scrolled a little and at the end, and names where", () => {
		assert.deepEqual(SCROLL_TO, [0, 80, "end"]);
		assert.equal(scrolledWords(80), "scrolled 80 px");
		assert.equal(scrolledWords("end"), "scrolled to the end");
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
		const text = '{"status":"work","workId":"work_1","lessonId":"chat_lab","lessonTitle":"Slope","kind":"lesson","tools":[{"name":"x"';
		assert.deepEqual(workOf(text), { lessonId: "chat_lab", task: undefined });
		assert.equal(workOf('{"status":"work","workId":"w","kind":"background task","task":"Graph extraction: a.md"}').task, "Graph extraction: a.md");
	});
});

describe("the stand-in agent", () => {
	it("puts its claude and codex first on the throwaway home's PATH", () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "layout-home-"));
		try {
			standInAgent(home);
			for (const name of ["claude", "codex"]) {
				const shim = path.join(home, "bin", name);
				assert.match(fs.readFileSync(shim, "utf8"), /layout-agent\.mjs/);
				assert.ok((fs.statSync(shim).mode & 0o111) !== 0, `${name} runs`);
			}
			assert.equal(fs.readFileSync(path.join(home, ".zshrc"), "utf8"), `export PATH=${JSON.stringify(path.join(home, "bin"))}:$PATH\n`);
		} finally {
			fs.rmSync(home, { recursive: true, force: true });
		}
	});

	it("throws when it can't write them, so the run stops before the window starts", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "layout-home-"));
		try {
			// A file where the home's bin folder should go.
			fs.writeFileSync(path.join(dir, "bin"), "");
			assert.throws(() => standInAgent(dir));
			assert.ok(!fs.existsSync(path.join(dir, ".zshrc")), "no PATH that points at nothing");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
