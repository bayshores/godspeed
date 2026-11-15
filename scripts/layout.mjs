/**
 * layout.mjs — `npm run layout`: the screens in the real Mac app window, checked for broken
 * layout.
 *
 * Chromium and WebKit lay some CSS out differently, and the Mac app draws with WebKit. This
 * builds the debug shell with its `screens` control channel (crates/shell/src/screens.rs), starts
 * it on a throwaway home and data folder, and has a stand-in agent write made-up data
 * (layout-seed.mjs). It then starts the app again with no agent connected, opens each screen in
 * layout-screens.mjs at each width, and runs layout-page.mjs in the page. A finding prints the
 * screen, the width, the check and the two elements, and saves a picture beside the report in
 * target/layout/. Mac only: elsewhere it passes at once.
 */
import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { seed } from "./layout-seed.mjs";
import { SCREENS, WIDTHS } from "./layout-screens.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const RUN = path.join(ROOT, "target", "layout");
const APP = path.join(ROOT, "target", "debug", "godspeed");
const HEIGHT = 900;
const POLL_MS = 20;
const READY_MS = 60_000;
/** The page is checked twice this far apart, and only findings seen both times count, so a
 *  screen still animating in is not a failure. */
const SETTLE_MS = 700;

/** The channel's answer as a value: JSON, or an Error for `error: <why>`. */
export function readAnswer(line) {
	if (line.startsWith("error: ")) return new Error(line.slice(7));
	return line === "ok" ? "ok" : JSON.parse(line);
}

/** One `eval` line that runs `source` as a script, newlines and all. */
export function evalLine(source) {
	return `eval (0, eval)(${JSON.stringify(source)})`;
}

/** The findings seen in both reads, in the order of the second. */
export function stableFindings(first, second) {
	const seen = new Set(first.map((f) => JSON.stringify(f)));
	return second.filter((f) => seen.has(JSON.stringify(f)));
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

/** A file name for a screen's picture. */
export function snapName(screen, width) {
	return `${screen.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${width}.png`;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function freePort() {
	return new Promise((done, fail) => {
		const server = net.createServer().listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			server.close(() => done(port));
		});
		server.on("error", fail);
	});
}

/** The app with its control channel: one command line in, one answer line out. */
async function startApp(port, name) {
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
			LH_DATA_DIR: path.join(RUN, "data"),
			HOME: path.join(RUN, "home"),
			TMPDIR: path.join(RUN, "tmp"),
			LH_SCREENS_CTL: ctl,
			LH_SCREENS_OUT: out,
		},
	});
	let exited = false;
	child.on("exit", () => {
		exited = true;
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
				const got = await send("eval window.__layout");
				if (got instanceof Error || !got) continue;
				if ("e" in got) throw new Error(got.e);
				return got.v;
			}
			throw new Error(`no answer from the page for ${body}`);
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

/** Runs the page check: the findings seen twice, SETTLE_MS apart. */
async function checkScreen(app, pageCheck) {
	const first = await app.value(evalLine(pageCheck));
	if (first.length === 0) return first;
	await sleep(SETTLE_MS);
	return stableFindings(first, await app.value(evalLine(pageCheck)));
}

async function main() {
	if (process.platform !== "darwin") {
		console.log("npm run layout runs on a Mac only (it needs the app's WebKit window); skipped.");
		return;
	}
	const started = Date.now();
	const step = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
	step("npm", ["run", "build", "--silent", "--", "--logLevel", "error"]);
	step("node", ["scripts/dev-resources.mjs"]);
	step("cargo", ["build", "-p", "gs-server", "-p", "gs-shell", "--features", "gs-shell/screens"]);
	const built = Date.now();

	fs.rmSync(RUN, { recursive: true, force: true });
	for (const dir of ["data", "home", "tmp"]) fs.mkdirSync(path.join(RUN, dir), { recursive: true });
	const port = Number(process.env.LH_PORT) || (await freePort());
	const pageCheck = `(() => { ${fs.readFileSync(path.join(import.meta.dirname, "layout-page.mjs"), "utf8").replace(/^export /gm, "")}; return checkPage(); })()`;

	// The first launch: the stand-in agent writes the data, then the app quits, so the second
	// launch starts with no agent connected.
	let app = await startApp(port, "seed");
	let ids;
	try {
		await app.ready();
		const page = {
			fetch: (url, init = {}) => app.run(`return fetch(${JSON.stringify(url)}, ${JSON.stringify(init)}).then((r) => r.status)`),
			start: (url, init) => app.value(`eval void fetch(${JSON.stringify(url)}, ${JSON.stringify(init)})`),
		};
		ids = await seed(path.join(RUN, "data"), page);
		const { settings } = JSON.parse(await app.run(`return fetch("/api/settings").then((r) => r.text())`));
		const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
		const general = { ...settings.general, onboarded: true, lastSeenVersion: version, activeSpace: ids.space, sounds: false, teacherName: "Quigley" };
		await page.fetch("/api/settings/general", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(general) });
	} finally {
		await app.quit();
	}

	const failures = [];
	app = await startApp(port, "walk");
	try {
		await app.ready();
		for (const screen of SCREENS) {
			try {
				if (screen.before) await app.run(fill(screen.before, ids));
				await app.value("eval window.__layoutLeft = true");
				await app.value(`nav ${app.origin}${fill(screen.url, ids)}`);
				await app.ready(screen.ready);
				if (screen.setup) await app.run(fill(screen.setup, ids));
				if (screen.shows) await app.ready(screen.shows);
			} catch (err) {
				const snap = path.join(RUN, snapName(`${screen.name} not shown`, WIDTHS[0]));
				await app.send(`snap ${snap}`);
				throw new Error(`${screen.name}: ${err.message}; picture: ${snap}`);
			}
			for (const width of WIDTHS) {
				await app.value(`size ${width} ${HEIGHT}`);
				await sleep(SETTLE_MS);
				// A screen smaller than the window would squeeze it and check another width.
				const shown = await app.value("eval innerWidth");
				if (shown !== width) throw new Error(`the window is ${shown} points wide, not ${width}: is the screen too small?`);
				const findings = await checkScreen(app, pageCheck);
				if (findings.length === 0) continue;
				const snap = path.join(RUN, snapName(screen.name, width));
				await app.value(`snap ${snap}`);
				for (const finding of findings) failures.push(findingLine(screen.name, width, finding));
				failures.push(`  picture: ${snap}`);
			}
		}
	} finally {
		await app.quit();
	}

	const report = path.join(RUN, "report.txt");
	const checked = `${SCREENS.length} screens at ${WIDTHS.join(", ")} points in ${Math.round((Date.now() - built) / 1000)} s (${Math.round((built - started) / 1000)} s to build)`;
	fs.writeFileSync(report, `${[...failures, checked].join("\n")}\n`);
	if (failures.length > 0) {
		console.error(`${failures.join("\n")}\nlayout: broken layout found; ${checked}. Report: ${report}`);
		process.exit(1);
	}
	console.log(`layout: no broken layout in ${checked}.`);
}

if (import.meta.main) await main();
