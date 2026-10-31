/**
 * One chat or job file with the wrong shape must read as absent, not blank
 * the whole list. Runs under an isolated LH_DATA_DIR (set before any
 * config-loading import, so app modules load dynamically).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-store-shape-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { PATHS } = await import("../src/config.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { jobStore } = await import("../src/store/jobs.ts");

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

describe("stores skip files with the wrong shape", () => {
	it("a null chat file or one without updatedAt doesn't hide the good lessons", () => {
		const good = chatStore.createChat("Good lesson");
		fs.writeFileSync(path.join(PATHS.chats, "chat_null.json"), "null", "utf-8");
		fs.writeFileSync(path.join(PATHS.chats, "chat_noupdate.json"), JSON.stringify({ id: "chat_noupdate", messages: [] }), "utf-8");

		assert.deepEqual(chatStore.listChats().map((c) => c.id), [good.id]);
		assert.equal(chatStore.getChat("chat_null"), null);
		assert.equal(chatStore.getChat("chat_noupdate"), null);
	});

	it("a null job file or one without updatedAt doesn't hide the good jobs", () => {
		const good = jobStore.createJob({ kind: "research", chatId: "chat_shape", toolCallId: "call-shape" });
		const jobsDir = path.join(PATHS.data, "jobs");
		fs.writeFileSync(path.join(jobsDir, "job_null.json"), "null", "utf-8");
		fs.writeFileSync(
			path.join(jobsDir, "job_noupdate.json"),
			JSON.stringify({ id: "job_noupdate", chatId: "chat_shape", status: "done" }),
			"utf-8",
		);

		assert.deepEqual(jobStore.listAllJobs().map((j) => j.id), [good.id]);
		assert.equal(jobStore.getJob("job_null"), null);
		assert.equal(jobStore.getJob("job_noupdate"), null);
	});
});
