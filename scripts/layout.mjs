/**
 * layout.mjs — `npm run layout`: the screens in the real Mac app window, checked for broken
 * layout.
 *
 * Chromium and WebKit lay some CSS out differently, and the Mac app draws with WebKit. This
 * builds the debug shell with its `screens` control channel (crates/shell/src/screens.rs), starts
 * it on a throwaway home and data folder, and has a stand-in agent write made-up data
 * (layout-seed.mjs). It then starts the app again with no agent connected and walks the screens
 * in layout-screens.mjs, two passes for each. The widths are dealt into parts (widthParts) that
 * run side by side, each this script again with its own app, home and data in
 * target/layout/part-N, walking every screen in the same order at its own widths:
 *
 * | Pass | When | What |
 * |---|---|---|
 * | Opening | The first screen at each address, at its widest and narrowest width | With motion on, the page is opened from Home (Home itself from Progress) as a link opens it, not by a full load, and watched for 1.5 s from its first paint (watchOpening in layout-page.mjs) |
 * | Still | Every screen, at every width (widthsOf) | A full load, motion off, checked as it opens, scrolled a little, scrolled to the end and, where it opened scrolled, at its top (checkPage) |
 *
 * A finding prints the screen (", opening" for the first pass), the width, the check and the
 * elements, and saves a picture in its part's folder; the report is target/layout/report.txt and
 * each part's own output target/layout/part-N.log. With `LAYOUT_STATES` set to
 * a folder, every lesson screen is also photographed there as it opens, at each width. With
 * `LAYOUT_ONLY` set to words, only the screens whose name holds them are walked (several, split by
 * commas): for a second look at a fix, never in place of the whole run. An opening is still watched
 * only on the first screen of the whole list at its address, as in the whole run; what a skipped
 * screen's `before` or `setup` leaves behind is missing. Mac only:
 * elsewhere it passes at once. Two runs in one worktree share that folder, so run one at a time.
 */
import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { seed } from "./layout-seed.mjs";
import { HTTP_OK, SCREENS, widthsOf } from "./layout-screens.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const TOP = path.join(ROOT, "target", "layout");
/** Set by the run for each of its parts, with the part's widths in LAYOUT_WIDTHS. */
const PART = process.env.LAYOUT_PART;
const RUN = PART ? path.join(TOP, `part-${PART}`) : TOP;
const APP = path.join(ROOT, "target", "debug", "godspeed");
// Inside the throwaway home: the desk reads a file only from under home, and a file it cannot read leaves its paper blank.
const DATA = path.join(RUN, "home", "data");
// Short enough for the screen of GitHub's Mac runner, so the laptop and CI judge the same window.
const HEIGHT = 680;
const POLL_MS = 20;
const READY_MS = 60_000;
/** The page is read this far apart until two reads in a row agree, at most READS times. */
const SETTLE_MS = 400;
/** Brings the key of an open menu or pop-up into the window; answers whether there is one. */
const OPENER_IN_VIEW = `(() => { const opener = document.querySelector("[aria-haspopup][aria-expanded=true]"); opener?.scrollIntoView({ block: "nearest" }); return Boolean(opener); })()`;
const READS = 6;
/** Animations and transitions end at once, so a read never sees a screen mid-move. */
const STILL = `if (!document.getElementById("layout-still")) {
	const style = document.createElement("style");
	style.id = "layout-still";
	style.textContent = "*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; }";
	document.head.append(style);
}
for (const animation of document.getAnimations()) {
	try { animation.finish(); } catch {}
}
null`;

/** An opening is watched this long at most once its page is ready; the watch itself is 1.5 s. */
const OPENING_MS = 10_000;
/** Waits up to 3 s until the page holds still: no page traveling, no animation that ends still playing. */
const AT_REST = `for (let n = 0; n < 30; n++) {
	const moving = document.querySelector(".lh-travel[data-way]") || document.getAnimations().some((a) => a.playState === "running" && a.effect?.getTiming().iterations !== Infinity);
	if (!moving) return;
	await new Promise((done) => setTimeout(done, 100));
}`;

/** An in-app page change, as a link makes it: the router follows the history's popstate and
 *  keeps the old page up until the new one's data is read. */
function goInApp(url) {
	return `history.pushState(null, "", ${JSON.stringify(url)}); dispatchEvent(new PopStateEvent("popstate")); null`;
}

/** The page an opening starts from, and what it shows once its data is drawn: Home, or for Home
 *  itself Progress. */
function openingFrom(url) {
	return url === "/" ? { url: "/space", ready: "[data-testid=space-overview] .lh-sheet" } : { url: "/", ready: "[data-testid=home-page] .lh-sheet" };
}

/** The widths an opening is watched at: a screen's widest and narrowest. */
function openingWidths(widths) {
	return [...new Set([Math.max(...widths), Math.min(...widths)])];
}

/** The channel's answer as a value: JSON, or an Error for `error: <why>`. */
export function readAnswer(line) {
	if (line.startsWith("error: ")) return new Error(line.slice(7));
	return line === "ok" ? "ok" : JSON.parse(line);
}

/** One `eval` line that runs `source` as a script, newlines and all. */
export function evalLine(source) {
	return `eval (0, eval)(${JSON.stringify(source)})`;
}

/** Whether two reads found the same things on the same elements; words may differ (a clock). */
export function sameFindings(first, second) {
	const keys = (findings) => findings.map((f) => f.key).sort().join("\n");
	return keys(first) === keys(second);
}

/** Why the window is not the size asked for, or null when it is. */
export function misfit(asked, shown) {
	if (asked.width === shown.width && asked.height === shown.height) return null;
	return `the window is ${shown.width} by ${shown.height} points, not ${asked.width} by ${asked.height}`;
}

/** One finding as the report line: screen, width, check, the elements. */
export function findingLine(screen, width, finding) {
	return `${screen} at ${width}: ${finding.check}: ${finding.what}`;
}

/** A screen's address or setup script with `{space}`, `{lesson}` and `{deadline}` filled in. */
export function fill(template, ids) {
	return template.replace(/\{(\w+)\}/g, (mark, name) => {
		if (!ids[name]) throw new Error(`no ${name} id for ${template}`);
		return ids[name];
	});
}

/** Where each screen is checked: as it opens (0: not scrolled), scrolled a little (what hangs over the top of a
 *  scroller shows only once content moves under it) and at the end. */
export const SCROLL_TO = [0, 80, "end"];

/** How a report names a scroll position. */
export function scrolledWords(at) {
	return at === "end" ? "scrolled to the end" : at === "top" ? "scrolled to the top" : `scrolled ${at} px`;
}

/** The run's widths dealt into at most `count` parts of about the same work: the widths walked
 *  most often first, each to the part with the least so far. Widest first in each part. */
export function widthParts(widthLists, count) {
	const load = new Map();
	for (const widths of widthLists) for (const width of widths) load.set(width, (load.get(width) ?? 0) + 1);
	const parts = Array.from({ length: Math.min(count, load.size) }, () => ({ widths: [], load: 0 }));
	for (const [width, walks] of [...load].sort((a, b) => b[1] - a[1] || b[0] - a[0])) {
		const part = parts.reduce((least, next) => (next.load < least.load ? next : least));
		part.widths.push(width);
		part.load += walks;
	}
	return parts.map((part) => part.widths.sort((a, b) => b - a));
}

/** How many parts run side by side: each is an app, its server and its page. One on a small machine, as CI's. */
const partCount = () => Math.max(1, Math.min(4, Math.floor(os.availableParallelism() / 4)));

/** `LAYOUT_ONLY`'s words, and whether a screen is walked. */
const ONLY = (process.env.LAYOUT_ONLY ?? "").toLowerCase().split(",").map((word) => word.trim()).filter(Boolean);
const walked = (screen) => ONLY.length === 0 || ONLY.some((word) => screen.name.toLowerCase().includes(word));

/** A file name for a screen's picture. */
export function snapName(screen, width) {
	return `${screen.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${width}.png`;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** The app now running, so a signal can stop it. */
let running = null;
/** The run's parts now running, so a signal reaches them. */
const partsRunning = new Set();

/** A run stopped from outside stops its parts and quits the app it started, and only that one, then fails. */
function stopOnSignals() {
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
		process.on(signal, async () => {
			for (const part of partsRunning) part.kill("SIGTERM");
			const app = running;
			if (app) {
				fs.appendFileSync(app.ctl, "quit\n");
				for (const end = Date.now() + 5_000; running === app && Date.now() < end; ) await sleep(100);
				if (running === app) process.kill(app.pid, "SIGKILL");
			}
			console.error(`layout: stopped by ${signal}`);
			process.exit(1);
		});
	}
}

function portFree(port) {
	return new Promise((done) => {
		const server = net.createServer().once("error", () => done(false));
		server.listen(port, "127.0.0.1", () => server.close(() => done(true)));
	});
}

function freePort() {
	return new Promise((done, fail) => {
		const server = net.createServer().listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			server.close(() => done(port));
		});
		server.on("error", fail);
	});
}

/** Where a screen hands the stand-in teacher a line, as if typed in its terminal (layout-agent.mjs). */
const typedFile = (home) => path.join(home, "typed");

/** A Start in the check runs layout-agent.mjs, never a real agent: its `claude` and `codex` are
 *  first on the throwaway home's PATH. The start script asks for the version first: that is
 *  answered and done, or a second stand-in would run in the terminal, outside the helper's mark,
 *  and take the lines meant for the teacher. It throws when it can't write them, so the run stops
 *  before the window starts. */
export function standInAgent(home) {
	const bin = path.join(home, "bin");
	fs.mkdirSync(bin);
	const run = `#!/bin/sh\n[ "$1" = --version ] && { echo "99.0.0 (stand-in)"; exit 0; }\nLAYOUT_TYPED=${JSON.stringify(typedFile(home))} exec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(import.meta.dirname, "layout-agent.mjs"))}\n`;
	for (const name of ["claude", "codex"]) fs.writeFileSync(path.join(bin, name), run, { mode: 0o755 });
	fs.writeFileSync(path.join(home, ".zshrc"), `export PATH=${JSON.stringify(bin)}:$PATH\n`);
}

/** Hands the stand-in teacher a screen's `teacher` line and waits until it has done it. */
async function tellTeacher(line) {
	const file = typedFile(path.join(RUN, "home"));
	fs.writeFileSync(file, line);
	for (const end = Date.now() + READY_MS; fs.existsSync(file); await sleep(100)) {
		if (Date.now() > end) throw new Error(`the stand-in teacher never did "${line}"`);
	}
}

/** The app with its control channel: one command line in, one answer line out. */
async function startApp(port, name) {
	// An app that quit a moment ago gives the port back late.
	for (const end = Date.now() + 5_000; !(await portFree(port)); await sleep(100)) {
		if (Date.now() > end) throw new Error(`port ${port} is in use`);
	}
	const dir = path.join(RUN, name);
	fs.mkdirSync(dir, { recursive: true });
	const ctl = path.join(dir, "ctl");
	const out = path.join(dir, "out");
	fs.writeFileSync(ctl, "");
	fs.writeFileSync(out, "");
	const log = fs.openSync(path.join(dir, "app.log"), "w");
	const child = spawn(APP, [], {
		stdio: ["ignore", log, log],
		env: {
			...process.env,
			LH_PORT: String(port),
			LH_DATA_DIR: DATA,
			HOME: path.join(RUN, "home"),
			// The agent's start script runs in zsh, which reads the home's .zshrc (standInAgent).
			SHELL: "/bin/zsh",
			TMPDIR: path.join(RUN, "tmp"),
			LH_SCREENS_CTL: ctl,
			LH_SCREENS_OUT: out,
			// godspeed's plugin list, made up, so the run never reads GitHub's.
			LH_PLUGIN_LIST: path.join(ROOT, "tests", "fixtures", "plugins", "layout-list.json"),
		},
	});
	let exited = false;
	const saved = { pid: child.pid, ctl };
	running = saved;
	child.on("exit", () => {
		exited = true;
		if (running === saved) running = null;
	});
	let answered = 0;
	const send = async (line) => {
		fs.appendFileSync(ctl, `${line}\n`);
		for (;;) {
			if (exited) throw new Error(`the app quit; see ${path.join(dir, "app.log")}`);
			const lines = fs.readFileSync(out, "utf8").split("\n").slice(0, -1);
			if (lines.length > answered) return readAnswer(lines[answered++]);
			await sleep(POLL_MS);
		}
	};
	const value = async (line) => {
		const answer = await send(line);
		if (answer instanceof Error) throw answer;
		return answer;
	};
	const app = {
		origin: `http://127.0.0.1:${port}`,
		send,
		value,
		/** Runs `body` in the page as an async function: what it returns, awaited. */
		run: async (body) => {
			await value(evalLine(`window.__layout = null; Promise.resolve().then(async () => { ${body} }).then((v) => { window.__layout = { v: v ?? null }; }, (e) => { window.__layout = { e: String(e) }; }); null`));
			for (const end = Date.now() + READY_MS; Date.now() < end; await sleep(POLL_MS)) {
				const got = await send(`eval window.__layout === undefined ? "reloaded" : window.__layout`);
				if (got === "reloaded") throw new Error(`the page reloaded before it answered ${body}`);
				if (got instanceof Error || !got) continue;
				if ("e" in got) throw new Error(got.e);
				return got.v;
			}
			throw new Error(`no answer from the page (at ${await send("eval location.href")}) for ${body}`);
		},
		/** Waits until the window shows an app page that has rendered `selector`. */
		ready: async (selector = "#root > *") => {
			// window.__layoutLeft marks a page the walk navigated away from.
			const test = `!window.__layoutLeft && location.origin === ${JSON.stringify(`http://127.0.0.1:${port}`)} && document.readyState === "complete" && document.fonts.status === "loaded" && !!document.querySelector(${JSON.stringify(selector)})`;
			for (const end = Date.now() + READY_MS; Date.now() < end; await sleep(100)) {
				if ((await send(`eval ${test}`)) === true) return;
			}
			throw new Error(`the page never showed ${selector} (at ${await send("eval location.href")})`);
		},
		quit: async () => {
			if (exited) return;
			await send("quit").catch(() => {});
			for (const end = Date.now() + 10_000; !exited && Date.now() < end; ) await sleep(100);
			if (!exited) child.kill("SIGKILL");
		},
	};
	return app;
}

/** Reads the page until two reads in a row agree, so what is drawn late is checked too; a page
 *  that never settles answers its last read. */
async function checkScreen(app, pageCheck) {
	let last = null;
	for (let read = 0; read < READS; read++) {
		if (read > 0) await sleep(SETTLE_MS);
		await app.value(evalLine(STILL));
		const findings = await app.value(evalLine(pageCheck));
		if (last && sameFindings(last, findings)) return findings;
		last = findings;
	}
	return last;
}

/** The opening pass for a screen at the address `url`: at each opening width, the page is opened
 *  from its start page in the app and watched. Answers its findings as report lines, and
 *  warnings. */
async function watchOpenings(app, screen, url, ids, pageSource, widths) {
	const lines = [];
	const warnings = [];
	const from = openingFrom(url);
	const inPage = (call) => evalLine(`(() => { ${pageSource}; return ${call}; })()`);
	// A full load first: the screen before may have left a menu open and motion off.
	await app.value("eval window.__layoutLeft = true");
	await app.value(`nav ${app.origin}${from.url}`);
	await app.ready(from.ready);
	let atStart = true;
	for (const width of widths) {
		const height = screen.height ?? HEIGHT;
		await app.value(`size ${width} ${height}`);
		await sleep(SETTLE_MS);
		const [shownWidth, shownHeight] = await app.value("eval [innerWidth, innerHeight]");
		// The still pass says why a width is not checked.
		if (misfit({ width, height }, { width: shownWidth, height: shownHeight })) continue;
		if (!atStart) {
			await app.value(`eval ${goInApp(from.url)}`);
			await app.ready(from.ready);
		}
		await app.run(AT_REST);
		await app.value(inPage(`watchOpening(${JSON.stringify(new URL(url, app.origin).pathname)})`));
		await app.value(`eval ${goInApp(url)}`);
		atStart = false;
		await app.ready(fill(screen.ready, ids));
		let read = null;
		for (const end = Date.now() + OPENING_MS; Date.now() < end; await sleep(100)) {
			read = await app.value(inPage("openingFindings()"));
			if (read.done) break;
		}
		const name = `${screen.name}, opening`;
		if (!read.done) {
			warnings.push(`WARNING: ${name} at ${width} was NOT watched: ${read.painted ? "the watch never ended" : "the new page never showed a sheet or traveled in"}`);
			continue;
		}
		if (read.findings.length === 0) continue;
		const snap = path.join(RUN, snapName(name, width));
		await app.value(`snap ${snap}`);
		for (const finding of read.findings) lines.push(findingLine(name, width, finding));
		lines.push(`  picture: ${snap}`);
	}
	return { lines, warnings };
}

/** One part of the run, as this script again: answers what it found (its result.json), or why it stopped. */
function runPart(number, widths) {
	const log = fs.openSync(path.join(TOP, `part-${number}.log`), "w");
	const child = spawn(process.execPath, [import.meta.filename], { cwd: ROOT, stdio: ["ignore", log, log], env: { ...process.env, LAYOUT_PART: String(number), LAYOUT_WIDTHS: widths.join(",") } });
	partsRunning.add(child);
	return new Promise((done) => {
		child.on("exit", () => {
			partsRunning.delete(child);
			const result = path.join(TOP, `part-${number}`, "result.json");
			const stopped = { failures: [], warnings: [], watched: [], error: `the part at ${widths.join(" and ")} points stopped with no result; see ${path.join(TOP, `part-${number}.log`)}` };
			done(fs.existsSync(result) ? JSON.parse(fs.readFileSync(result, "utf8")) : stopped);
		});
	});
}

async function main() {
	if (process.platform !== "darwin") {
		console.log("npm run layout runs on a Mac only (it needs the app's WebKit window); skipped.");
		return;
	}
	stopOnSignals();
	if (PART) return walkPart(new Set(process.env.LAYOUT_WIDTHS.split(",").map(Number)));
	const started = Date.now();
	const step = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
	step("npm", ["run", "build", "--silent", "--", "--logLevel", "error"]);
	step("node", ["scripts/dev-resources.mjs"]);
	step("cargo", ["build", "-p", "gs-server", "-p", "gs-shell", "--features", "gs-shell/screens"]);
	const built = Date.now();

	const screens = SCREENS.filter(walked);
	if (screens.length === 0) throw new Error(`LAYOUT_ONLY="${process.env.LAYOUT_ONLY}" names no screen`);
	fs.rmSync(TOP, { recursive: true, force: true });
	fs.mkdirSync(TOP, { recursive: true });
	if (process.env.LAYOUT_STATES) fs.mkdirSync(process.env.LAYOUT_STATES, { recursive: true });
	const parts = widthParts(screens.map(widthsOf), partCount());
	const results = await Promise.all(parts.map((widths, index) => runPart(index + 1, widths)));

	const failures = results.flatMap((result) => result.failures);
	const warnings = results.flatMap((result) => result.warnings);
	const errors = results.flatMap((result) => (result.error ? [result.error] : []));
	const watched = new Set(results.flatMap((result) => result.watched)).size;
	const report = path.join(TOP, "report.txt");
	const checked = `${ONLY.length > 0 ? `ONLY ${screens.length} of ${SCREENS.length}` : SCREENS.length} screens at 1440, 1100 and 640 points (lessons at 1320 and 800 too), each as it opens, ${SCROLL_TO.slice(1).map(scrolledWords).join(" and ")} (and at its top where it opens scrolled), and ${watched} openings watched, in ${Math.round((Date.now() - started) / 1000)} s (${Math.round((built - started) / 1000)} s to build, ${parts.length} parts side by side)`;
	fs.writeFileSync(report, `${[...failures, ...errors, ...warnings, checked].join("\n")}\n`);
	for (const warning of warnings) console.warn(warning);
	if (errors.length > 0) {
		console.error(`${[...failures, ...errors].join("\n")}\nlayout: the run stopped before its end; ${checked}. Report: ${report}`);
		process.exit(1);
	}
	if (failures.length > 0) {
		console.error(`${failures.join("\n")}\nlayout: broken layout found; ${checked}. Report: ${report}`);
		process.exit(1);
	}
	console.log(`layout: no broken layout in ${checked}.${warnings.length > 0 ? ` ${warnings.length} WARNINGS above: some widths were not checked.` : ""}`);
}

/** One part: its own home, seeded, then every screen walked in order at the part's widths. Leaves
 *  what it found in its result.json. */
async function walkPart(mine) {
	fs.rmSync(RUN, { recursive: true, force: true });
	for (const dir of ["home/data", "tmp"]) fs.mkdirSync(path.join(RUN, dir), { recursive: true });
	// Silent from the first page load: the run's windows are hidden, but their sounds are heard. The menu bar item stays
	// off so a check never adds one to the owner's menu bar.
	fs.writeFileSync(path.join(DATA, "settings.json"), JSON.stringify({ version: 3, general: { startupSound: false, sounds: false, menuBarCountdown: false } }));
	standInAgent(path.join(RUN, "home"));
	const port = await freePort();
	const pageSource = fs.readFileSync(path.join(import.meta.dirname, "layout-page.mjs"), "utf8").replace(/^export /gm, "");
	const inPage = (call) => `(() => { ${pageSource}; return ${call}; })()`;
	const pageCheck = inPage("checkPage()");
	const scrollTo = (at) => inPage(`scrollMain(${JSON.stringify(at)})`);

	const failures = [];
	const warnings = [];
	/** The addresses whose first screen is behind the walk, and the screens whose opening this part watched. */
	const opened = new Set();
	const watched = [];
	const result = (error) => fs.writeFileSync(path.join(RUN, "result.json"), JSON.stringify({ failures, warnings, watched, ...(error ? { error } : {}) }));
	try {
		// The first launch: the stand-in agent writes the data, then the app quits, so the second
		// launch starts with no agent connected.
		let app = await startApp(port, "seed");
		let ids;
		try {
			await app.ready();
			const seedLog = path.join(RUN, "seed", "seed.log");
			const log = (line) => fs.appendFileSync(seedLog, `${new Date().toISOString()} ${line}\n`);
			const page = {
				fetch: async (url, init = {}) => {
					log(`page fetches ${init.method ?? "GET"} ${url}`);
					const status = await app.run(`return fetch(${JSON.stringify(url)}, ${JSON.stringify(init)})${HTTP_OK}.then((r) => r.status)`);
					log(`page got ${status} for ${url}`);
					return status;
				},
				json: async (url) => JSON.parse(await app.run(`return fetch(${JSON.stringify(url)})${HTTP_OK}.then((r) => r.text())`)),
			};
			ids = await seed(DATA, page, log).catch((err) => {
				throw new Error(`${err.message}; steps: ${seedLog}`);
			});
			const { settings } = JSON.parse(await app.run(`return fetch("/api/settings")${HTTP_OK}.then((r) => r.text())`));
			const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
			const general = { ...settings.general, onboarded: true, lastSeenVersion: version, activeSpace: ids.space, teacherName: "Quigley" };
			await page.fetch("/api/settings/general", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(general) });
		} finally {
			await app.quit();
		}

		const states = process.env.LAYOUT_STATES;
		// The window's size as a screen is loaded and set up: what the screen before left, in every part alike.
		let left = null;
		app = await startApp(port, "walk");
		try {
			await app.ready();
			for (const screen of SCREENS) {
				if (!walked(screen)) {
					opened.add(fill(screen.url, ids));
					continue;
				}
				const all = widthsOf(screen);
				const widths = all.filter((width) => mine.has(width));
				try {
					if (screen.before) await app.run(fill(screen.before, ids));
					const url = fill(screen.url, ids);
					// The terminal's page opens only in a window of its own, by a full load.
					if (!opened.has(url) && url !== "/terminal-window") {
						opened.add(url);
						// The opening pass leaves the window at the screen's narrowest width.
						left = `${Math.min(...all)} ${screen.height ?? HEIGHT}`;
						const openings = openingWidths(all).filter((width) => mine.has(width));
						if (openings.length > 0) {
							watched.push(screen.name);
							const opening = await watchOpenings(app, screen, url, ids, pageSource, openings);
							failures.push(...opening.lines);
							warnings.push(...opening.warnings);
						}
					}
					if (left) await app.value(`size ${left}`);
					await app.value("eval window.__layoutLeft = true");
					await app.value(`nav ${app.origin}${url}`);
					await app.ready(fill(screen.ready, ids));
					if (screen.setup) await app.run(fill(screen.setup, ids));
					if (screen.teacher) await tellTeacher(fill(screen.teacher, ids));
					if (screen.shows) await app.ready(fill(screen.shows, ids));
				} catch (err) {
					const snap = path.join(RUN, snapName(`${screen.name} not shown`, widths[0] ?? all[0]));
					await app.send(`snap ${snap}`);
					throw new Error(`${screen.name}: ${err.message}; picture: ${snap}`);
				}
				for (const width of widths) {
					const height = screen.height ?? HEIGHT;
					await app.value(`size ${width} ${height}`);
					await sleep(SETTLE_MS);
					// A screen smaller than the window squeezes it, and the check would judge another size.
					const [shownWidth, shownHeight] = await app.value("eval [innerWidth, innerHeight]");
					const problem = misfit({ width, height }, { width: shownWidth, height: shownHeight });
					if (problem && width === Math.min(...all) && !screen.height) throw new Error(`${problem}: the screen is too small for the narrowest width`);
					if (problem) {
						warnings.push(`WARNING: ${screen.name} at ${width} was NOT checked: ${problem}; the screen is too small`);
						continue;
					}
					// A menu is opened from a key in view; a narrower window may have pushed its row out of the window.
					const menuOpen = await app.value(evalLine(OPENER_IN_VIEW));
					if (menuOpen) await sleep(SETTLE_MS);
					// A screen that opens scrolled (a lesson, at its rest) is checked at its top too, last. Not one the
					// walk itself scrolled to an open menu's key: at its top the menu would lie outside the window.
					const opensScrolled = !menuOpen && (await app.value(evalLine(inPage("scrolledAt()")))) > 1;
					for (const at of opensScrolled ? [...SCROLL_TO, "top"] : SCROLL_TO) {
						if (at !== 0 && !(await app.value(evalLine(scrollTo(at === "top" ? 0 : at))))) continue;
						const findings = await checkScreen(app, pageCheck);
						if (states && at === 0 && screen.url.startsWith("/chat/")) await app.value(`snap ${path.join(states, snapName(screen.name, width))}`);
						if (findings.length === 0) continue;
						const name = at === 0 ? screen.name : `${screen.name}, ${scrolledWords(at)}`;
						const snap = path.join(RUN, snapName(name, width));
						await app.value(`snap ${snap}`);
						for (const finding of findings) failures.push(findingLine(name, width, finding));
						failures.push(`  picture: ${snap}`);
					}
					await app.value(evalLine(scrollTo(0)));
				}
				left = `${all.at(-1)} ${screen.height ?? HEIGHT}`;
			}
		} finally {
			await app.quit();
		}
	} catch (err) {
		result(err.message);
		throw err;
	}
	result();
}

if (import.meta.main) await main();
