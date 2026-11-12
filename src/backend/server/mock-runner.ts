/**
 * RUN EXAMPLES, on this computer: the learner's code for a mock's code
 * question is saved to a folder of its own in the system's temp folder and
 * run with Node (the app's own) or the computer's Python, with a time
 * limit. What it printed is read by core/mock-run.ts.
 */
import { execFile, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

export function runExamples(question: CodeQuestion, code: string, language: MockLanguage): Promise<RunOutcome> {
	const command = commandFor(language);
	if (!command) return Promise.resolve({ examples: [], error: "godspeed couldn't find Python on this computer. Install Python 3, or answer in JavaScript." });
	const mark = `__godspeed_${randomUUID()}__`;
	// The real path: it is the one the error text names.
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "godspeed-run-")));
	const file = path.join(dir, RUN_FILE[language]);
	fs.writeFileSync(file, runnerSource(code, question.fn, question.examples, language, mark));
	return new Promise((resolve) => {
		const [program, ...args] = command;
		const child = execFile(
			program!,
			[...args, file],
			{ cwd: dir, timeout: RUN_SECONDS * 1000, killSignal: "SIGKILL", maxBuffer: MAX_OUTPUT, env: runEnv() },
			(err, stdout, stderr) => {
				fs.rmSync(dir, { recursive: true, force: true });
				if (err?.killed) resolve({ examples: [], error: `Your code ran for more than ${RUN_SECONDS} seconds and was stopped.` });
				else if (err && (err as NodeJS.ErrnoException).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") resolve({ examples: [], error: "Your code printed too much and was stopped." });
				// The temp folder's path says nothing to the learner.
				else resolve(readRun(stdout, stderr.replaceAll(dir + path.sep, ""), mark, question.examples));
			},
		);
		// Nothing is typed in: input() ends at once instead of waiting out the time limit.
		child.stdin?.end();
	});
}
