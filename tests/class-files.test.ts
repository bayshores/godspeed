/**
 * CLASSES WAVE PINS (2026-10-26), Phase 3/7 — the to-text step and the
 * transcriber's program lookup (no whisper run here).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileToText, transcriptToText, walkLinkedFolder, RecordingNeedsTranscriptError } from "../src/server/class-files.ts";
import { findProgram } from "../src/server/transcribe.ts";

describe("transcriptToText", () => {
	it("strips WebVTT headers, timings, tags and rolling duplicates", () => {
		const vtt = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\n<v Prof>Today: gradients.</v>\n\n2\n00:00:03.000 --> 00:00:05.000\nToday: gradients.\nThey point uphill.\n";
		assert.equal(transcriptToText(vtt), "Today: gradients.\nThey point uphill.");
	});
	it("strips SRT cue numbers and timings", () => {
		const srt = "1\r\n00:00:01,000 --> 00:00:02,000\r\nHello\r\n\r\n2\r\n00:00:02,000 --> 00:00:03,000\r\nworld\r\n";
		assert.equal(transcriptToText(srt), "Hello\nworld");
	});
});

describe("fileToText and the folder walk", () => {
	it("reads text, routes recordings to the transcriber, walks only supported files", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-class-files-"));
		try {
			fs.writeFileSync(path.join(dir, "a.md"), "# Notes");
			fs.writeFileSync(path.join(dir, "talk.m4a"), "");
			fs.writeFileSync(path.join(dir, ".hidden.md"), "x");
			fs.writeFileSync(path.join(dir, "img.png"), "x");
			fs.mkdirSync(path.join(dir, "sub"));
			fs.writeFileSync(path.join(dir, "sub", "b.srt"), "1\n00:00:01,000 --> 00:00:02,000\nHi\n");
			assert.equal(await fileToText(path.join(dir, "a.md")), "# Notes");
			assert.equal(await fileToText(path.join(dir, "sub", "b.srt")), "Hi");
			await assert.rejects(fileToText(path.join(dir, "talk.m4a")), RecordingNeedsTranscriptError);
			assert.deepEqual(walkLinkedFolder(dir), ["a.md", "sub/b.srt", "talk.m4a"]);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("findProgram", () => {
	it("finds an executable on PATH and returns null when absent", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-bin-"));
		try {
			const exe = path.join(dir, "whisper-cli");
			fs.writeFileSync(exe, "#!/bin/sh\n");
			fs.chmodSync(exe, 0o755);
			assert.equal(findProgram("whisper-cli", { PATH: dir }), exe);
			assert.equal(findProgram("definitely-not-a-program-xyz", { PATH: dir }), null);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
