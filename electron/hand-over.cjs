"use strict";

// This is the last Electron godspeed. The next one is a new app, and these
// decide when this one says so.

const fs = require("node:fs");

const DOWNLOAD_URL = "https://github.com/bayshores/godspeed/releases/latest";

const OLD_MAC_NOTICE = {
	type: "info",
	message: "This Mac will not get new versions of godspeed.",
	detail: "The next version needs macOS 14 or newer. This version keeps working.",
	buttons: ["OK"],
};

const NEW_APP_NOTICE = {
	type: "info",
	message: "A new godspeed is ready.",
	detail: "It is a new app, so it cannot install over this one by itself. Download it and run the installer. Your spaces and lessons stay.",
	buttons: ["Download", "Later"],
	defaultId: 0,
	cancelId: 1,
};

const NEWER_APP_OPEN_NOTICE = {
	type: "info",
	message: "A newer godspeed is already open. Quit it first.",
	buttons: ["OK"],
};

/** Darwin 23 is macOS 14, the oldest macOS the next godspeed opens on. */
function macTooOld(platform, osRelease) {
	return platform === "darwin" && Number.parseInt(osRelease, 10) < 23;
}

/** The Windows and Linux feeds name this version and add newApp, the new
 *  app's version, since the new app cannot install over this one. */
function hasNewApp(updateInfo) {
	return typeof updateInfo?.newApp === "string" && updateInfo.newApp !== "";
}

/** The newer godspeed writes its pid to shell.pid while it runs. A missing
 *  or unreadable file, or a pid that no longer runs, means it is closed. */
function newerAppOpen(pidFile) {
	let pid;
	try {
		pid = Number(fs.readFileSync(pidFile, "utf8").trim());
	} catch {
		return false;
	}
	// 0 and negative pids name process groups; our own pid is a stale file.
	if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

module.exports = { DOWNLOAD_URL, OLD_MAC_NOTICE, NEW_APP_NOTICE, NEWER_APP_OPEN_NOTICE, macTooOld, hasNewApp, newerAppOpen };
