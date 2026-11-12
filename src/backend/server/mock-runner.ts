/**
 * RUN EXAMPLES, on this computer: the learner's code for a mock's code
 * question is saved to a folder of its own in the system's temp folder and
 * run with Node (the app's own) or the computer's Python, with a time
 * limit. What it printed is read by core/mock-run.ts.
 */
import { execFile, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { CodeQuestion, MockLanguage } from "../../shared/core/mock.ts";
import { RUN_FILE, RUN_SECONDS, readRun, runnerSource, type RunOutcome } from "../../shared/core/mock-run.ts";
import { HOMEBREW_BIN_DIRS, findProgram } from "./transcribe.ts";

const MAX_OUTPUT = 1024 * 1024;

/** The server's environment without godspeed's own settings: LH_DESKTOP_API_SECRET
 *  opens the app's whole API, and the learner's program has no use for any of them. */
function runEnv(): NodeJS.ProcessEnv {
	// Inside the app the server's own binary is Electron; this makes it plain Node.
	// Python on Windows prints to a pipe in the old code page, so "→" would crash.
	const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: "1", PYTHONIOENCODING: "utf-8" };
	for (const key of Object.keys(env)) if (key.toUpperCase().startsWith("LH_")) delete env[key];
	// The app's compile cache would gain a file for every run's new temp folder.
	delete env.NODE_COMPILE_CACHE;
	delete env.NODE_OPTIONS;
	return env;
}

/** A Python that only stands in for one: without Apple's developer tools the
 *  Mac's /usr/bin/python3 opens their install dialog, and without Python
 *  Windows' WindowsApps python.exe opens the Store. */
export function isStandInPython(file: string, platform: NodeJS.Platform, hasDevTools: () => boolean): boolean {
	if (platform === "darwin") return file === "/usr/bin/python3" && !hasDevTools();
	if (platform === "win32") return file.toLowerCase().includes("\\windowsapps\\");
	return false;
}

const hasDevTools = () => spawnSync("/usr/bin/xcode-select", ["-p"], { stdio: "ignore" }).status === 0;

/** The command that runs Python files: Windows' py launcher first, then
 *  python3 or python. An app opened from the Dock has only the system
 *  folders on its PATH, so on a Mac Homebrew's Python comes first. */
function pythonCommand(): string[] | null {
	if (process.platform === "win32") {
		const py = findProgram("py");
		if (py) return [py, "-3"];
	}
	const env = process.platform === "darwin" ? { PATH: [...HOMEBREW_BIN_DIRS, process.env.PATH ?? ""].join(path.delimiter) } : process.env;
	const real = (file: string) => !isStandInPython(file, process.platform, hasDevTools);
	const found = findProgram("python3", env, real) ?? findProgram("python", env, real);
	return found ? [found] : null;
}

/** The command that runs a language, or null when this computer has none. */
function commandFor(language: MockLanguage): string[] | null {
	return language === "javascript" ? [process.execPath] : pythonCommand();
}

/** How to end a run and every process in it, or null when nothing may be
 *  ended: on macOS and Linux the run leads its own process group, so the
 *  whole group; on Windows its process tree, only while the program runs,
 *  since once it has ended its pid may already be another program's. */
export function stopCommand(pid: number, platform: NodeJS.Platform, running: boolean): { group: number } | { command: string[] } | null {
	if (platform !== "win32") return { group: pid };
	return running ? { command: ["taskkill", "/T", "/F", "/PID", String(pid)] } : null;
}

/** End the run's processes, then call `done`. */
function stopAll(child: ChildProcess, done: () => void): void {
	const how = child.pid === undefined ? null : stopCommand(child.pid, process.platform, child.exitCode === null && child.signalCode === null);
	if (how && "command" in how) {
		execFile(how.command[0]!, how.command.slice(1), { windowsHide: true }, () => done());
		return;
	}
	if (how) {
		try {
			process.kill(-how.group, "SIGKILL");
		} catch {
			/* every process of it has ended */
		}
	}
	done();
}

/** Run the learner's code on the question's examples. `signal` stops it
 *  when the request that asked for it goes away. */
export function runExamples(question: CodeQuestion, code: string, language: MockLanguage, signal?: AbortSignal): Promise<RunOutcome> {
	const command = commandFor(language);
	if (!command) return Promise.resolve({ examples: [], error: "godspeed couldn't find Python on this computer. Install Python 3, or answer in JavaScript." });
	const mark = `__godspeed_${randomUUID()}__`;
	// The real path: it is the one the error text names.
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "godspeed-run-")));
	const file = path.join(dir, RUN_FILE[language]);
	fs.writeFileSync(file, runnerSource(code, question.fn, question.examples, language, mark));
	return new Promise((resolve) => {
		const [program, ...args] = command;
		const child = spawn(program!, [...args, file], { cwd: dir, env: runEnv(), detached: process.platform !== "win32", windowsHide: true });
		const out: Buffer[] = [];
		const err: Buffer[] = [];
		const size = { out: 0, err: 0 };
		let ended = false;
		const end = (outcome: () => RunOutcome) => {
			if (ended) return;
			ended = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", aborted);
			// The folder goes once the processes are gone (Windows keeps a running
			// program's folder), and one left behind never holds up the answer.
			stopAll(child, () => fs.rm(dir, { recursive: true, force: true, maxRetries: 5 }, () => {}));
			child.stdout.destroy();
			child.stderr.destroy();
			resolve(outcome());
		};
		const stopped = (error: string) => end(() => ({ examples: [], error }));
		const aborted = () => stopped("The run was stopped.");
		const timer = setTimeout(() => stopped(`Your code ran for more than ${RUN_SECONDS} seconds and was stopped.`), RUN_SECONDS * 1000);
		signal?.addEventListener("abort", aborted, { once: true });
		if (signal?.aborted) aborted();
		const keep = (into: Buffer[], key: keyof typeof size) => (chunk: Buffer) => {
			size[key] += chunk.length;
			if (size[key] > MAX_OUTPUT) stopped("Your code printed too much and was stopped.");
			else into.push(chunk);
		};
		child.stdout.on("data", keep(out, "out"));
		child.stderr.on("data", keep(err, "err"));
		// What the program started may still hold its output open: end it all
		// once the program itself is done, so its output closes too.
		child.on("exit", () => stopAll(child, () => {}));
		child.on("error", () => end(() => readRun("", "", mark, question.examples)));
		child.on("close", () =>
			// The temp folder's path, also as a file:// URL when Node read the
			// code as a module, says nothing to the learner.
			end(() => readRun(Buffer.concat(out).toString("utf8"), Buffer.concat(err).toString("utf8").replaceAll(pathToFileURL(dir + path.sep).href, "").replaceAll(dir + path.sep, ""), mark, question.examples)),
		);
		// Nothing is typed in: input() ends at once instead of waiting out the time limit.
		child.stdin.end();
	});
}
