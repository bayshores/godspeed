/**
 * Local transcription: recordings (.mp3 .m4a .wav .mp4 .mov) become text on
 * the learner's own computer with whisper.cpp, at no cost. The learner
 * installs it with `brew install whisper-cpp ffmpeg`; godspeed finds it.
 *
 *   1. ffmpeg converts the recording to 16 kHz mono WAV (whisper's input)
 *   2. whisper-cli writes the transcript (.txt)
 *
 * The speech model (ggml-base.en, ~150 MB) downloads once to
 * data/models/ on first use.
 *
 * Programs are run with execFile (no shell) and fixed argument lists —
 * file paths are arguments, never interpolated into a command line.
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { PATHS } from "../config.ts";
import { SPEECH_TOOL_INSTALL } from "../core/contracts.ts";

/** Shown on a file's badge when the programs are missing. */
const WHISPER_INSTALL_HINT = `Recordings need whisper.cpp and ffmpeg. Run \`${SPEECH_TOOL_INSTALL}\`, then retry the file.`;

export class WhisperMissingError extends Error {
	constructor(public readonly missing: string[]) {
		super(WHISPER_INSTALL_HINT);
		this.name = "WhisperMissingError";
	}
}

const WHISPER_MODEL_NAME = "ggml-base.en.bin";
const WHISPER_MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${WHISPER_MODEL_NAME}`;

/** Apps opened from the Dock don't inherit the shell's PATH, so the
 *  Homebrew prefixes are searched explicitly. */
const EXTRA_BIN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];

/** The first executable named `name` on PATH or in the Homebrew prefixes. */
export function findProgram(name: string, env: Record<string, string | undefined> = process.env): string | null {
	const dirs = [...(env.PATH ?? "").split(path.delimiter).filter(Boolean), ...EXTRA_BIN_DIRS];
	const names = process.platform === "win32" ? [`${name}.exe`, name] : [name];
	for (const dir of dirs) {
		for (const n of names) {
			const candidate = path.join(dir, n);
			try {
				fs.accessSync(candidate, fs.constants.X_OK);
				if (fs.statSync(candidate).isFile()) return candidate;
			} catch {
				/* not here */
			}
		}
	}
	return null;
}

interface TranscriberTools {
	whisper: string;
	ffmpeg: string;
}

/** Both programs, or a WhisperMissingError naming what's missing. */
function locateTranscriber(): TranscriberTools {
	const whisper = findProgram("whisper-cli") ?? findProgram("whisper-cpp");
	const ffmpeg = findProgram("ffmpeg");
	const missing = [...(whisper ? [] : ["whisper-cpp"]), ...(ffmpeg ? [] : ["ffmpeg"])];
	if (missing.length > 0) throw new WhisperMissingError(missing);
	return { whisper: whisper!, ffmpeg: ffmpeg! };
}

function run(program: string, args: string[], signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		execFile(program, args, { signal, maxBuffer: 16 * 1024 * 1024 }, (err, _stdout, stderr) => {
			if (err) {
				const tail = String(stderr ?? "").trim().split("\n").slice(-3).join(" ");
				reject(new Error(`${path.basename(program)} failed: ${tail || err.message}`, { cause: err }));
			} else resolve();
		});
	});
}

/** The speech model's path, downloading it once (tmp + rename, so a broken
 *  download never leaves a half model behind). */
async function ensureWhisperModel(signal?: AbortSignal): Promise<string> {
	const dir = path.join(PATHS.data, "models");
	const file = path.join(dir, WHISPER_MODEL_NAME);
	if (fs.existsSync(file)) return file;
	fs.mkdirSync(dir, { recursive: true });
	console.info(`[transcribe] downloading ${WHISPER_MODEL_NAME} (~150 MB, one time)`);
	const response = await fetch(WHISPER_MODEL_URL, { signal });
	if (!response.ok || !response.body) throw new Error(`Speech model download failed (HTTP ${response.status})`);
	const tmp = `${file}.tmp-${crypto.randomUUID().slice(0, 8)}`;
	try {
		// pipeline turns a write error (a full disk) into a rejection instead of a hang.
		await pipeline(response.body as unknown as AsyncIterable<Uint8Array>, fs.createWriteStream(tmp));
		fs.renameSync(tmp, file);
	} catch (err) {
		fs.rmSync(tmp, { force: true });
		throw err;
	}
	return file;
}

/** Transcribe one recording to plain text at `outFile`. */
export async function transcribeRecording(recording: string, outFile: string, signal?: AbortSignal): Promise<string> {
	const tools = locateTranscriber();
	const model = await ensureWhisperModel(signal);
	const work = fs.mkdtempSync(path.join(os.tmpdir(), "godspeed-transcribe-"));
	try {
		const wav = path.join(work, "audio.wav");
		await run(tools.ffmpeg, ["-y", "-loglevel", "error", "-i", recording, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], signal);
		const base = path.join(work, "transcript");
		await run(tools.whisper, ["-m", model, "-f", wav, "-otxt", "-of", base, "-np"], signal);
		const text = fs.readFileSync(`${base}.txt`, "utf-8").replace(/\r\n?/g, "\n").trim();
		fs.mkdirSync(path.dirname(outFile), { recursive: true });
		fs.writeFileSync(outFile, text + "\n", "utf-8");
		return text;
	} finally {
		fs.rmSync(work, { recursive: true, force: true });
	}
}
