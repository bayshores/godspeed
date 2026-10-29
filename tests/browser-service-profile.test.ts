/** The helper's throwaway profiles, on a real temp folder. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { helperProfileDir, removeStaleHelperProfiles } from "../electron/browser-service-profile.cjs";

async function finishedPid(): Promise<number> {
	const child = spawn(process.execPath, ["-e", ""]);
	await once(child, "exit");
	return child.pid!;
}

describe("browser-service helper profiles", () => {
	it("removes profiles of helpers that are gone and keeps the rest", async () => {
		const temp = mkdtempSync(path.join(tmpdir(), "helper-profiles-"));
		try {
			const gone = helperProfileDir(temp, await finishedPid());
			const live = helperProfileDir(temp, process.pid);
			for (const dir of [gone, live, path.join(temp, "godspeed-browser-service-x"), path.join(temp, "other")]) {
				mkdirSync(path.join(dir, "Default"), { recursive: true });
			}
			removeStaleHelperProfiles(temp);
			assert.deepEqual(readdirSync(temp).sort(), [
				path.basename(live), "godspeed-browser-service-x", "other",
			].sort());
		} finally {
			rmSync(temp, { recursive: true, force: true });
		}
	});

	it("does nothing when the temp folder can't be read", () => {
		assert.doesNotThrow(() => removeStaleHelperProfiles(path.join(tmpdir(), "missing-helper-profiles")));
	});
});
