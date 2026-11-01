/**
 * The speech model downloads once even when two recordings are transcribed
 * at the same time, and a failed download lets the next file retry.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-whisper-model-"));
process.env.LH_DATA_DIR = dataDir;
const { ensureWhisperModel } = await import("../src/server/transcribe.ts");

let fetches = 0;
let failNext = false;
globalThis.fetch = (async () => {
	fetches++;
	if (failNext) {
		failNext = false;
		return new Response(null, { status: 503 });
	}
	return new Response("model bytes");
}) as typeof fetch;

describe("ensureWhisperModel", () => {
	it("a failed download is not cached, and concurrent callers share one download", async () => {
		failNext = true;
		await assert.rejects(ensureWhisperModel(), /HTTP 503/);
		fetches = 0;
		const [a, b] = await Promise.all([ensureWhisperModel(), ensureWhisperModel()]);
		assert.equal(fetches, 1);
		assert.equal(a, b);
		assert.equal(fs.readFileSync(a, "utf-8"), "model bytes");
		await ensureWhisperModel();
		assert.equal(fetches, 1, "a model on disk is not downloaded again");
		fs.rmSync(dataDir, { recursive: true, force: true });
	});
});
