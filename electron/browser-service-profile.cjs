// The browser-service helper's throwaway Chromium profile, one per helper
// process. No Electron import, so it is testable without a display.
const fs = require("node:fs");
const path = require("node:path");

const PREFIX = "godspeed-browser-service-";

/**
 * @param {string} tempDir
 * @param {number} pid
 */
function helperProfileDir(tempDir, pid) {
	return path.join(tempDir, `${PREFIX}${pid}`);
}

/** @param {number} pid */
function isRunning(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		// EPERM: the process exists but belongs to someone else.
		return /** @type {NodeJS.ErrnoException} */ (err).code === "EPERM";
	}
}

/**
 * A helper that was killed (on Windows kill skips will-quit) or whose
 * profile files were still locked at quit leaves its profile behind, and
 * Windows never clears temp. Each new helper removes the ones whose helper
 * is gone.
 * @param {string} tempDir
 */
function removeStaleHelperProfiles(tempDir) {
	let names;
	try {
		names = fs.readdirSync(tempDir);
	} catch {
		return;
	}
	for (const name of names) {
		if (!name.startsWith(PREFIX)) continue;
		const pid = Number(name.slice(PREFIX.length));
		if (!Number.isInteger(pid) || pid <= 0 || isRunning(pid)) continue;
		try {
			fs.rmSync(path.join(tempDir, name), { recursive: true, force: true });
		} catch {
			/* still locked: a later helper tries again */
		}
	}
}

module.exports = { helperProfileDir, removeStaleHelperProfiles };
