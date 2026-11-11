// What the TypeScript transcriber gives: the program lookup, the speech model download (fetch is
// replaced) and whole transcriptions run with the stand-in ffmpeg and whisper-cli in tests/fixtures.
// Paths in the output are relative to a temp folder shown as <root>.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PATHS } from "../../../../src/backend/config.ts";
import { ensureWhisperModel, findProgram, transcribeRecording, WhisperMissingError } from "../../../../src/backend/server/transcribe.ts";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const mutablePaths = PATHS as { data: string };

function tidy(text: string, root: string): string {
	return text.split(root).join("<root>").replace(/godspeed-transcribe-[A-Za-z0-9]{6}/g, "godspeed-transcribe-XXXXXX");
}

async function inRoot<T>(run: (root: string) => Promise<T> | T): Promise<T> {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "gs-transcribe-golden-"));
	const saved = { data: mutablePaths.data, tmpdir: process.env.TMPDIR, path: process.env.PATH, fetch: globalThis.fetch };
	try {
		return await run(root);
	} finally {
		mutablePaths.data = saved.data;
		if (saved.tmpdir === undefined) delete process.env.TMPDIR;
		else process.env.TMPDIR = saved.tmpdir;
		process.env.PATH = saved.path;
		globalThis.fetch = saved.fetch;
		fs.rmSync(root, { recursive: true, force: true });
	}
}

function file(target: string, content: string | Buffer, mode = 0o644): void {
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, content);
	fs.chmodSync(target, mode);
}

// ── findProgram ────────────────────────────────────────────────────────────

function lookupTree(root: string): void {
	file(path.join(root, "a", "tool-x"), "#!/bin/sh\n", 0o644);
	file(path.join(root, "b", "tool-x"), "#!/bin/sh\n", 0o755);
	file(path.join(root, "c", "tool-x"), "#!/bin/sh\n", 0o755);
	fs.mkdirSync(path.join(root, "d", "tool-x"), { recursive: true });
	fs.mkdirSync(path.join(root, "e"));
	fs.symlinkSync(path.join(root, "b", "tool-x"), path.join(root, "e", "tool-x"));
	fs.mkdirSync(path.join(root, "f"));
	fs.symlinkSync(path.join(root, "nowhere"), path.join(root, "f", "tool-x"));
	file(path.join(root, "g", "tool-x"), "#!/bin/sh\n", 0o100);
	fs.mkdirSync(path.join(root, "h"));
	fs.symlinkSync(path.join(root, "a", "tool-x"), path.join(root, "h", "tool-x"));
	file(path.join(root, "i", "tool-y"), "#!/bin/sh\n", 0o755);
}

const lookups: [string, string | undefined, string][] = [
	["tool-x", "$R/a:$R/b:$R/c", "the first runnable one wins"],
	["tool-x", "$R/a:$R/h", "plain files and links to them do not run"],
	["tool-x", "$R/d:$R/c", "a folder with the name is skipped"],
	["tool-x", "$R/f:$R/e", "a broken link is skipped, a good one is returned unresolved"],
	["tool-x", "$R/g", "owner-only execute counts"],
	["tool-x", "$R/a/../b//:$R/c", "the folder is tidied like path.join"],
	["tool-x", "::$R/c:", "empty entries are skipped"],
	["tool-x", "", "an empty path finds nothing"],
	["tool-x", undefined, "no path finds nothing"],
	["tool-y", "$R/i", "another name"],
	["tool-x", "$R/i", "a name that is not there"],
];

// ── transcribeRecording ────────────────────────────────────────────────────

function toolsDir(root: string): string {
	const bin = path.join(root, "bin");
	for (const name of ["ffmpeg", "whisper-cli"]) file(path.join(bin, name), fs.readFileSync(path.join(fixtures, name)), 0o755);
	return bin;
}

function setUp(root: string): { bin: string; recordings: string; out: string } {
	const bin = toolsDir(root);
	fs.mkdirSync(path.join(root, "tmp"));
	fs.mkdirSync(path.join(root, "recordings"));
	file(path.join(root, "data", "models", "ggml-base.en.bin"), "stub speech model\n");
	mutablePaths.data = path.join(root, "data");
	process.env.TMPDIR = path.join(root, "tmp");
	process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
	return { bin, recordings: path.join(root, "recordings"), out: path.join(root, "out") };
}

async function transcribe(name: string, outFile?: (out: string) => string, before?: (out: string) => void) {
	return inRoot(async (root) => {
		const { bin, recordings, out } = setUp(root);
		before?.(out);
		const target = outFile ? outFile(out) : path.join(out, `${name}.txt`);
		const recording = path.join(recordings, name);
		let result: Record<string, unknown>;
		try {
			result = { text: await transcribeRecording(recording, target) };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			result = { error: tidy(message, root), missing: err instanceof WhisperMissingError };
		}
		const written = fs.existsSync(target) && fs.statSync(target).isFile() ? fs.readFileSync(target, "utf-8") : null;
		const calls = fs.existsSync(path.join(bin, "calls.log")) ? fs.readFileSync(path.join(bin, "calls.log"), "utf-8") : "";
		return { ...result, written, calls: tidy(calls, root), tmpLeft: fs.readdirSync(path.join(root, "tmp")) };
	});
}

const recordingNames = [
	"talk.mp3",
	"blank-talk.m4a",
	"crlf-talk.mp3",
	"lone-cr.wav",
	"bom.mp3",
	"badutf8.mp3",
	"nbsp.mp3",
	"nel.mp3",
	"ws-only.mp3",
	"unicode.mov",
	"spaces and 'quotes' & $x.MP4",
	"ffmpeg-fail.mp3",
	"ffmpeg-silent.mp3",
	"ffmpeg-blank.mp3",
	"ffmpeg-signal.mp3",
	"ffmpeg-flood-out.mp3",
	"ffmpeg-flood-err.mp3",
	"ffmpeg-nowav.mp3",
	"whisper-fail.wav",
	"whisper-lines.wav",
	"whisper-nofile.wav",
];

// ── ensureWhisperModel ─────────────────────────────────────────────────────

type Reply = () => Response | Promise<Response>;

async function downloadCase(replies: Reply[], calls = 1, before?: (data: string) => void, rounds = 1) {
	return inRoot(async (root) => {
		const data = path.join(root, "data");
		mutablePaths.data = data;
		before?.(data);
		let fetches = 0;
		globalThis.fetch = (async () => {
			const reply = replies[Math.min(fetches, replies.length - 1)]!;
			fetches++;
			return reply();
		}) as typeof fetch;
		const results: PromiseSettledResult<string>[] = [];
		for (let round = 0; round < rounds; round++) results.push(...(await Promise.allSettled(Array.from({ length: calls }, () => ensureWhisperModel()))));
		const models = path.join(data, "models");
		return {
			results: results.map((r) => (r.status === "fulfilled" ? { path: tidy(r.value, root) } : { error: tidy(String(r.reason?.message ?? r.reason), root) })),
			fetches,
			models: fs.existsSync(models) && fs.statSync(models).isDirectory() ? fs.readdirSync(models).sort() : null,
			content: fs.existsSync(path.join(models, "ggml-base.en.bin")) ? fs.readFileSync(path.join(models, "ggml-base.en.bin"), "utf-8") : null,
		};
	});
}

// Some bytes arrive and the file opens before the connection breaks.
const broken: Reply = () => {
	let pulls = 0;
	return new Response(
		new ReadableStream({
			async pull(controller) {
				if (pulls++ === 0) return controller.enqueue(new TextEncoder().encode("abc"));
				await new Promise((resolve) => setTimeout(resolve, 100));
				controller.error(new TypeError("terminated"));
			},
		}),
	);
};

const cases: Record<string, () => unknown> = {
	findProgram: () =>
		inRoot((root) => {
			lookupTree(root);
			return lookups.map(([name, pathTemplate, note]) => {
				const found = findProgram(name, { PATH: pathTemplate?.split("$R").join(root) });
				return { name, path: pathTemplate ?? null, note, found: found === null ? null : tidy(found, root) };
			});
		}),
	"transcribeRecording": async () => {
		const out: Record<string, unknown> = {};
		for (const name of recordingNames) out[name] = await transcribe(name);
		return out;
	},
	"transcribeRecording output file": async () => ({
		nested: await transcribe("talk.mp3", (o) => path.join(o, "a", "b", "c.txt")),
		overwritten: await transcribe("talk.mp3", undefined, (o) => file(path.join(o, "talk.mp3.txt"), "old text that is longer than the new one will be, much longer, really\n")),
		underAFile: await transcribe("talk.mp3", (o) => path.join(o, "plain", "c.txt"), (o) => file(path.join(o, "plain"), "x")),
		ontoAFolder: await transcribe("talk.mp3", (o) => path.join(o, "folder"), (o) => fs.mkdirSync(path.join(o, "folder"), { recursive: true })),
	}),
	"ensureWhisperModel downloads": async () => ({
		ok: await downloadCase([() => new Response("model bytes")]),
		http503: await downloadCase([() => new Response(null, { status: 503 })]),
		http404: await downloadCase([() => new Response("nope", { status: 404 })]),
		http204: await downloadCase([() => new Response(null, { status: 204 })]),
		fetchFails: await downloadCase([() => Promise.reject(new TypeError("fetch failed"))]),
		bodyBreaks: await downloadCase([broken]),
		alreadyThere: await downloadCase([() => new Response("never")], 1, (data) => file(path.join(data, "models", "ggml-base.en.bin"), "on disk")),
		modelsIsAFile: await downloadCase([() => new Response("never")], 1, (data) => file(path.join(data, "models"), "x")),
		shared: await downloadCase([() => new Response("model bytes")], 3),
		sharedFailure: await downloadCase([() => new Response(null, { status: 503 })], 3),
		retryAfterFailure: await downloadCase([() => new Response(null, { status: 503 }), () => new Response("model bytes")], 1, undefined, 2),
		sharedThenRetry: await downloadCase([() => new Response(null, { status: 503 }), () => new Response("model bytes")], 2, undefined, 2),
	}),
};

export default cases;
