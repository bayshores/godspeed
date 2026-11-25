import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { evalLine, fill, findingLine, misfit, readAnswer, sameFindings, scrolledWords, SCROLL_TO, snapName, standInAgent } from "../../scripts/layout.mjs";
import { boxMoved, carried, cross, cutOf, emptyBand, hollow, inkOf, lineBox, linesOf, meet, movedSince, offGap, offInset, outside, probes, roomUnder, scrollerClip, sticksOut, tightPad, tooWide } from "../../scripts/layout-page.mjs";
import { PLAN_ORDER_SENT_BACK, WAITING_TOPIC, WRITTEN_TOPIC } from "../../scripts/layout-lessons.mjs";
import { SPRING_EXAM } from "../../scripts/layout-jobs.mjs";
import { SCREENS, widthsOf } from "../../scripts/layout-screens.mjs";

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

	it("a page has empty room when it ends well under the last thing it holds", () => {
		assert.equal(roomUnder(584, 584), 0);
		assert.equal(roomUnder(584.4, 583), 0, "rounding");
		assert.equal(roomUnder(584, 507), 77);
		assert.equal(roomUnder(500, 584), 0, "what it holds may reach past it");
	});

	it("a box's sides are off unless every one is the inset", () => {
		assert.ok(!offInset([24, 24, 24.4], 24));
		assert.ok(offInset([24, 20, 24], 24));
	});
});

describe("hollow box", () => {
	it("finds the tallest band between two drawn things that nothing crosses", () => {
		// A title and a key at the top, the writing box and the keys at the foot.
		const band = emptyBand([box(0, 500, 300, 540), box(0, 20, 200, 48), box(220, 20, 300, 60), box(0, 560, 300, 600)]);
		assert.deepEqual([band?.top, band?.bottom, band?.height], [60, 500, 440]);
		assert.deepEqual(band?.above, box(220, 20, 300, 60), "the thing reaching lowest above it");
		assert.deepEqual(band?.below, box(0, 500, 300, 540));
	});

	it("a tall thing beside short ones closes the band it crosses", () => {
		assert.equal(emptyBand([box(0, 0, 100, 20), box(200, 0, 300, 400), box(0, 380, 100, 400)]), null);
	});

	it("room above the first thing and under the last is not a band, nor one thing alone", () => {
		assert.equal(emptyBand([box(0, 300, 100, 320)]), null);
		assert.equal(emptyBand([]), null);
		assert.equal(emptyBand([box(0, 10, 100, 30), box(0, 30, 100, 50)]), null, "touching things leave no band");
	});

	it("a band is hollow past 160 px and past 35% of its sheet", () => {
		assert.ok(hollow(200, 500));
		assert.ok(!hollow(160, 300), "160 px is the least");
		assert.ok(!hollow(300, 1000), "under 35% of a tall sheet");
		assert.ok(hollow(351, 1000));
	});
});

describe("the opening watch", () => {
	const at = (left: number, top: number, width: number, height: number) => ({ left, top, width, height });

	it("a box moved when it moves or changes size by more than 2 pixels", () => {
		assert.ok(!boxMoved(at(0, 0, 100, 40), at(2, 1, 101, 42)), "rounding");
		assert.ok(boxMoved(at(0, 0, 100, 40), at(0, 12, 100, 40)));
		assert.ok(boxMoved(at(0, 0, 100, 40), at(0, 0, 100, 80)), "it grew");
	});

	it("names what moved or left since the first paint, and what is new", () => {
		const first = { "1": at(0, 0, 100, 40), "2": at(0, 60, 100, 40), "3": at(0, 120, 100, 40) };
		const later = { "1": at(0, 0, 100, 40), "2": at(0, 90, 100, 40), "4": at(0, 200, 100, 40) };
		assert.deepEqual(movedSince(first, later), {
			moved: [
				{ id: "2", from: at(0, 60, 100, 40), to: at(0, 90, 100, 40) },
				{ id: "3", from: at(0, 120, 100, 40), to: null },
			],
			arrived: ["4"],
		});
		assert.deepEqual(movedSince(first, first), { moved: [], arrived: [] });
	});

	it("a box carried by the box around it, or gone with it, is that box's move", () => {
		const outer = { id: "1", from: at(0, 100, 600, 400), to: at(0, 140, 600, 400) };
		assert.ok(carried({ id: "2", from: at(20, 120, 200, 40), to: at(20, 160, 200, 40) }, outer));
		assert.ok(!carried({ id: "2", from: at(20, 120, 200, 40), to: at(20, 200, 200, 40) }, outer), "it moved further");
		assert.ok(!carried({ id: "2", from: at(20, 120, 200, 40), to: at(20, 160, 200, 80) }, outer), "it grew too");
		assert.ok(carried({ id: "2", from: at(20, 120, 200, 40), to: null }, { ...outer, to: null }), "it left with it");
		assert.ok(!carried({ id: "2", from: at(20, 120, 200, 40), to: null }, outer), "it left on its own");
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

describe("keys", () => {
	it("a key with less than 8 points beside its words is tight", () => {
		assert.equal(tightPad(4, 4), true);
		assert.equal(tightPad(8, 20), false);
	});
	it("keys on three lines are a pile, a row of keys is one line", () => {
		assert.equal(linesOf([10, 11, 10]), 1);
		assert.equal(linesOf([10, 50, 90]), 3);
	});
	it("a key far wider than its words is wide", () => {
		assert.equal(tooWide(300, 80), true);
		assert.equal(tooWide(120, 80), false);
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

	it("checks every screen down to 640, the narrowest window, lessons at 1320 and 800 too, and a screen with widths of its own only at those", () => {
		assert.deepEqual(widthsOf({ url: "/chat/{lesson}" }), [1440, 1320, 1100, 800, 640]);
		assert.deepEqual(widthsOf({ url: "/space" }), [1440, 1100, 640]);
		assert.deepEqual(widthsOf({ url: "/chat/{lesson}", widths: [800, 640] }), [800, 640]);
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

describe("the screens", () => {
	// A page the check never opens is a page nobody looked at.
	it("open every page the router has, and one address it does not have", () => {
		const router = fs.readFileSync(path.join(import.meta.dirname, "../../src/frontend/routes/router.tsx"), "utf8");
		const pages = [...router.matchAll(/\bpath: "([^"*]+)"/g)].map((m) => m[1]!);
		assert.ok(pages.length >= 9, "the router's pages were read");
		const opened = SCREENS.map((s: { url: string }) => s.url.split("?")[0]!);
		const shape = (page: string) => new RegExp(`^/${page.replace(/:[A-Za-z]+/g, "[^/]+")}$`);
		for (const page of pages) assert.ok(opened.some((url) => shape(page).test(url)), `no screen opens /${page}`);
		assert.ok(opened.includes("/"), "no screen opens Home");
		assert.ok(opened.some((url) => url !== "/" && !pages.some((page) => shape(page).test(url))), "no screen opens an address that is no page");
	});
});

describe("the stand-in agent", () => {
	it("knows the server's words for a card it sends back for plan order", () => {
		const server = fs.readFileSync(new URL("../../crates/agent/src/tools/questions.rs", import.meta.url), "utf-8");
		assert.ok(server.includes(PLAN_ORDER_SENT_BACK));
	});
});

describe("the stand-in helper", () => {
	it("plays a lesson's reply through the lesson tools and ends the turn on the question", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "layout-helper-"));
		const helper = spawn(process.execPath, [path.join(import.meta.dirname, "../../scripts/layout-helper.mjs")], { env: { ...process.env, LAYOUT_HELPER_DIR: dir }, stdio: ["pipe", "pipe", "inherit"] });
		const lines = createInterface({ input: helper.stdout })[Symbol.asyncIterator]();
		const say = (message: object) => helper.stdin.write(`${JSON.stringify(message)}\n`);
		const next = async () => JSON.parse((await lines.next()).value as string) as { type: string; message?: { type: string; subtype?: string }; name?: string; id?: string };
		try {
			say({ type: "open", session: "s1" });
			assert.equal((await next()).type, "opened");
			say({ type: "send", session: "s1", content: [{ type: "text", text: WRITTEN_TOPIC }] });
			let message = await next();
			while (message.type === "sdk") message = await next();
			assert.equal(message.type, "tool_call");
			assert.equal(message.name, "ask_user_question");
			say({ type: "tool_result", id: message.id, content: [{ type: "text", text: "Shown." }], isError: false, endTurn: true });
			message = await next();
			assert.deepEqual([message.type, message.message?.type, message.message?.subtype], ["sdk", "result", "success"]);
		} finally {
			helper.kill();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
	it("asks to run a command once, and writes a reply's first sentence and then reads a file, when a screen asks a held lesson", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "layout-helper-"));
		const helper = spawn(process.execPath, [path.join(import.meta.dirname, "../../scripts/layout-helper.mjs")], { env: { ...process.env, LAYOUT_HELPER_DIR: dir }, stdio: ["pipe", "pipe", "inherit"] });
		const lines = createInterface({ input: helper.stdout })[Symbol.asyncIterator]();
		const say = (message: object) => helper.stdin.write(`${JSON.stringify(message)}\n`);
		const next = async () => JSON.parse((await lines.next()).value as string) as { type: string; tool?: string; input?: { command: string }; message?: { type: string; event?: { delta: { text: string } }; message?: { content: { type: string; text?: string; name?: string }[] } } };
		const ask = async (request: string) => {
			fs.writeFileSync(path.join(dir, "desk"), request);
			while (fs.existsSync(path.join(dir, "desk"))) await new Promise((done) => setTimeout(done, 20));
		};
		try {
			say({ type: "open", session: "s1" });
			await next();
			say({ type: "send", session: "s1", content: [{ type: "text", text: WAITING_TOPIC }] });
			assert.equal((await next()).message?.type, "system");
			await ask("approve");
			await ask("approve");
			await ask("stream");
			const seen = [];
			for (let message = await next(); message.type !== "sdk" || message.message?.type !== "stream_event"; message = await next()) seen.push(message);
			const approvals = seen.filter((message) => message.type === "approval");
			assert.equal(approvals.length, 1);
			assert.deepEqual([approvals[0]!.tool, approvals[0]!.input], ["Bash", { command: "ls notes" }]);
			// The words stream, then come whole, then a file is read: a step after them.
			let message = await next();
			while (message.message?.type === "stream_event") message = await next();
			assert.deepEqual(message.message?.message?.content.map((block) => block.type), ["text"]);
			assert.match(message.message?.message?.content[0]?.text ?? "", /^To solve an equation/);
			assert.equal((await next()).message?.message?.content[0]?.name, "Read");
		} finally {
			helper.kill();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
	it("answers a job with the tool it must call, and holds the spring exam's mock until it is stopped", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "layout-helper-"));
		fs.writeFileSync(path.join(dir, "passage"), "f_000000000000:1");
		const helper = spawn(process.execPath, [path.join(import.meta.dirname, "../../scripts/layout-helper.mjs")], { env: { ...process.env, LAYOUT_HELPER_DIR: dir }, stdio: ["pipe", "pipe", "inherit"] });
		const lines = createInterface({ input: helper.stdout })[Symbol.asyncIterator]();
		const say = (message: object) => helper.stdin.write(`${JSON.stringify(message)}\n`);
		const next = async () => JSON.parse((await lines.next()).value as string) as { type: string; message?: { type: string; subtype?: string }; name?: string; id?: string };
		const past = async (type: string) => {
			let message = await next();
			while (message.type === "sdk" && message.message?.type !== type) message = await next();
			return message;
		};
		const job = (session: string, deadline: string) => {
			say({ type: "open", session, persist: false, cwd: dir, tools: [{ name: "write_mock_questions" }] });
			say({ type: "send", session, content: [{ type: "text", text: `They are preparing for: ${deadline} (exam).` }] });
		};
		try {
			job("s1", "Midterm");
			assert.equal((await next()).type, "opened");
			const call = await past("tool_call");
			assert.deepEqual([call.type, call.name], ["tool_call", "write_mock_questions"]);
			say({ type: "tool_result", id: call.id, content: [{ type: "text", text: "Saved." }], isError: false });
			assert.deepEqual((await past("result")).message?.subtype, "success");
			job("s2", SPRING_EXAM);
			assert.equal((await next()).type, "opened");
			assert.equal((await next()).message?.type, "system");
			say({ type: "interrupt", session: "s2" });
			assert.deepEqual((await past("result")).message?.subtype, "error_during_execution");
		} finally {
			helper.kill();
			fs.rmSync(dir, { recursive: true, force: true });
		}
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
				// The start script's version check must end, and must not start an agent.
				assert.match(execFileSync(shim, ["--version"], { encoding: "utf8", timeout: 5000 }), /^99\.0\.0 /);
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
