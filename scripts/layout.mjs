/**
 * layout.mjs — `npm run layout`: the screens in the real Mac app window, checked for broken
 * layout.
 *
 * Chromium and WebKit lay some CSS out differently, and the Mac app draws with WebKit. This
 * builds the debug shell with its `screens` control channel (crates/shell/src/screens.rs), starts
 * it on a throwaway home and data folder, and has a stand-in agent write made-up data
 * (layout-seed.mjs). Lessons and jobs play on a stand-in for the Claude helper (layout-helper.mjs, named
 * by LH_CLAUDE_HELPER), so no agent runs. It then starts the app again with no agent in its
 * terminal and walks the screens
 * in layout-screens.mjs, two passes for each:
 *
 * | Pass | When | What |
 * |---|---|---|
 * | Opening | The first screen at each address, at its widest and narrowest width | With motion on, the page is opened from Home (Home itself from Progress) as a link opens it, not by a full load, and watched for 1.5 s from its first paint (watchOpening in layout-page.mjs) |
 * | Still | Every screen, at every width (widthsOf) | A full load, motion off, checked as it opens, scrolled a little and scrolled to the end (checkPage) |
 *
 * A finding prints the screen (", opening" for the first pass), the width, the check and the
 * elements, and saves a picture beside the report in target/layout/. With `LAYOUT_STATES` set to
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
import * as path from "node:path";
import { seed } from "./layout-seed.mjs";
import { HTTP_OK, SCREENS, widthsOf } from "./layout-screens.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const RUN = path.join(ROOT, "target", "layout");
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
	return at === "end" ? "scrolled to the end" : `scrolled ${at} px`;
}

/** A file name for a screen's picture. */
export function snapName(screen, width) {
	return `${screen.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${width}.png`;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** The app now running, so a signal can stop it. */
let running = null;

/** A run stopped from outside quits the app it started, and only that one, then fails. */
function stopOnSignals() {
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
		process.on(signal, async () => {
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

/** The folder the stand-in helper keeps its state in, and takes a screen's request from (layout-helper.mjs). */
const HELPER_DIR = path.join(RUN, "helper");

/** A Start in the check runs layout-agent.mjs, never a real agent: its `claude` and `codex` are
 *  first on the throwaway home's PATH. The start script asks for the version first: that is
 *  answered and done, or a second stand-in would run in the terminal, outside the helper's mark,
 *  and take the lines meant for the teacher. It throws when it can't write them, so the run stops
 *  before the window starts. */
export function standInAgent(home) {
	const bin = path.join(home, "bin");
	fs.mkdirSync(bin);
	const run = `#!/bin/sh\n[ "$1" = --version ] && { echo "99.0.0 (stand-in)"; exit 0; }\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(import.meta.dirname, "layout-agent.mjs"))}\n`;
	for (const name of ["claude", "codex"]) fs.writeFileSync(path.join(bin, name), run, { mode: 0o755 });
	fs.writeFileSync(path.join(home, ".zshrc"), `export PATH=${JSON.stringify(bin)}:$PATH\n`);
}

/** Asks the stand-in helper, holding a lesson's reply, for one of its requests (`read`, `approve`
 *  or `stream`, layout-helper.mjs), and waits until it has done it. */
async function tellHelper(request) {
	const file = path.join(HELPER_DIR, "desk");
	fs.writeFileSync(file, request);
	for (const end = Date.now() + READY_MS; fs.existsSync(file); await sleep(100)) {
		if (Date.now() > end) throw new Error(`the stand-in helper never did "${request}"`);
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
			// Lessons and jobs play on a stand-in for the Claude helper, a debug build only.
			LH_CLAUDE_HELPER: path.join(import.meta.dirname, "layout-helper.mjs"),
			LAYOUT_HELPER_DIR: HELPER_DIR,
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
async function watchOpenings(app, screen, url, ids, pageSource) {
	const lines = [];
	const warnings = [];
	const from = openingFrom(url);
	const inPage = (call) => evalLine(`(() => { ${pageSource}; return ${call}; })()`);
	// A full load first: the screen before may have left a menu open and motion off.
	await app.value("eval window.__layoutLeft = true");
	await app.value(`nav ${app.origin}${from.url}`);
	await app.ready(from.ready);
	let atStart = true;
	for (const width of openingWidths(widthsOf(screen))) {
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
			console.warn(warnings.at(-1));
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

async function main() {
	if (process.platform !== "darwin") {
		console.log("npm run layout runs on a Mac only (it needs the app's WebKit window); skipped.");
		return;
	}
	stopOnSignals();
	const started = Date.now();
	const step = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
	step("npm", ["run", "build", "--silent", "--", "--logLevel", "error"]);
	step("node", ["scripts/dev-resources.mjs"]);
	step("cargo", ["build", "-p", "gs-server", "-p", "gs-shell", "--features", "gs-shell/screens"]);
	const built = Date.now();

	fs.rmSync(RUN, { recursive: true, force: true });
	for (const dir of ["home/data", "tmp", "helper"]) fs.mkdirSync(path.join(RUN, dir), { recursive: true });
	// Silent from the first page load: the run's windows are hidden, but their sounds are heard. The menu bar item stays
	// off so a check never adds one to the owner's menu bar.
	fs.writeFileSync(path.join(DATA, "settings.json"), JSON.stringify({ version: 3, general: { startupSound: false, sounds: false, menuBarCountdown: false } }));
	standInAgent(path.join(RUN, "home"));
	const port = await freePort();
	const pageSource = fs.readFileSync(path.join(import.meta.dirname, "layout-page.mjs"), "utf8").replace(/^export /gm, "");
	const pageCheck = `(() => { ${pageSource}; return checkPage(); })()`;
	const scrollTo = (at) => `(() => { ${pageSource}; return scrollMain(${JSON.stringify(at)}); })()`;

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
		ids = await seed(DATA, HELPER_DIR, page, log).catch((err) => {
			throw new Error(`${err.message}; steps: ${seedLog}`);
		});
		const { settings } = JSON.parse(await app.run(`return fetch("/api/settings")${HTTP_OK}.then((r) => r.text())`));
		const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
		const general = { ...settings.general, onboarded: true, lastSeenVersion: version, activeSpace: ids.space, teacherName: "Quigley" };
		await page.fetch("/api/settings/general", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(general) });
	} finally {
		await app.quit();
	}

	const failures = [];
	const warnings = [];
	/** The addresses whose first screen is behind the walk, and how many of their openings were watched. */
	const opened = new Set();
	let watched = 0;
	const states = process.env.LAYOUT_STATES;
	if (states) fs.mkdirSync(states, { recursive: true });
	const only = (process.env.LAYOUT_ONLY ?? "").toLowerCase().split(",").map((word) => word.trim()).filter(Boolean);
	const walked = (screen) => only.length === 0 || only.some((word) => screen.name.toLowerCase().includes(word));
	const count = SCREENS.filter(walked).length;
	if (count === 0) throw new Error(`LAYOUT_ONLY="${process.env.LAYOUT_ONLY}" names no screen`);
	app = await startApp(port, "walk");
	try {
		await app.ready();
		for (const screen of SCREENS) {
			if (!walked(screen)) {
				opened.add(fill(screen.url, ids));
				continue;
			}
			const widths = widthsOf(screen);
			try {
				if (screen.before) await app.run(fill(screen.before, ids));
				const url = fill(screen.url, ids);
				// The terminal's page opens only in a window of its own, by a full load.
				if (!opened.has(url) && url !== "/terminal-window") {
					opened.add(url);
					watched += 1;
					const opening = await watchOpenings(app, screen, url, ids, pageSource);
					failures.push(...opening.lines);
					warnings.push(...opening.warnings);
				}
				await app.value("eval window.__layoutLeft = true");
				await app.value(`nav ${app.origin}${url}`);
				await app.ready(fill(screen.ready, ids));
				if (screen.setup) await app.run(fill(screen.setup, ids));
				if (screen.helper) await tellHelper(screen.helper);
				if (screen.shows) await app.ready(fill(screen.shows, ids));
			} catch (err) {
				const snap = path.join(RUN, snapName(`${screen.name} not shown`, widths[0]));
				await app.send(`snap ${snap}`);
				// What the screens before it found is still worth reading.
				fs.writeFileSync(path.join(RUN, "report.txt"), `${[...failures, ...warnings].join("\n")}\n`);
				throw new Error(`${screen.name}: ${err.message}; picture: ${snap}; findings so far: ${path.join(RUN, "report.txt")}`);
			}
			for (const width of widths) {
				const height = screen.height ?? HEIGHT;
				await app.value(`size ${width} ${height}`);
				await sleep(SETTLE_MS);
				// A screen smaller than the window squeezes it, and the check would judge another size.
				const [shownWidth, shownHeight] = await app.value("eval [innerWidth, innerHeight]");
				const problem = misfit({ width, height }, { width: shownWidth, height: shownHeight });
				if (problem && width === Math.min(...widths) && !screen.height) throw new Error(`${problem}: the screen is too small for the narrowest width`);
				if (problem) {
					warnings.push(`WARNING: ${screen.name} at ${width} was NOT checked: ${problem}; the screen is too small`);
					console.warn(warnings.at(-1));
					continue;
				}
				// A menu is opened from a key in view; a narrower window may have pushed its row out of the window.
				if (await app.value(evalLine(OPENER_IN_VIEW))) await sleep(SETTLE_MS);
				for (const at of SCROLL_TO) {
					if (at !== 0 && !(await app.value(evalLine(scrollTo(at))))) continue;
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
		}
	} finally {
		await app.quit();
	}

	const report = path.join(RUN, "report.txt");
	const checked = `${only.length > 0 ? `ONLY ${count} of ${SCREENS.length}` : SCREENS.length} screens at 1440, 1100 and 640 points (lessons at 1320 and 800 too), each as it opens, ${SCROLL_TO.slice(1).map(scrolledWords).join(" and ")}, and ${watched} openings watched, in ${Math.round((Date.now() - built) / 1000)} s (${Math.round((built - started) / 1000)} s to build)`;
	fs.writeFileSync(report, `${[...failures, ...warnings, checked].join("\n")}\n`);
	if (failures.length > 0) {
		console.error(`${failures.join("\n")}\nlayout: broken layout found; ${checked}. Report: ${report}`);
		process.exit(1);
	}
	console.log(`layout: no broken layout in ${checked}.${warnings.length > 0 ? ` ${warnings.length} WARNINGS above: some widths were not checked.` : ""}`);
}

if (import.meta.main) await main();
