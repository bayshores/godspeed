import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { OLD_MAC_NOTICE, NEW_APP_NOTICE, NEWER_APP_OPEN_NOTICE, macTooOld, hasNewApp, newerAppOpen } = require("../../electron/hand-over.cjs");

test("Macs before macOS 14 (Darwin 23) are too old for the next godspeed", () => {
	for (const release of ["21.6.0", "22.1.0", "22.6.0"]) assert.equal(macTooOld("darwin", release), true, release);
	for (const release of ["23.0.0", "24.6.0", "27.2.0"]) assert.equal(macTooOld("darwin", release), false, release);
	assert.equal(macTooOld("win32", "10.0.19045"), false);
	assert.equal(macTooOld("linux", "6.8.0-generic"), false);
	assert.equal(macTooOld("darwin", "unknown"), false);
});

test("only a feed with a newApp version asks for the new app", () => {
	assert.equal(hasNewApp({ version: "0.5.51", newApp: "0.6.0" }), true);
	for (const info of [{ version: "0.5.51" }, { version: "0.5.51", newApp: "" }, { newApp: 6 }, null, undefined]) assert.equal(hasNewApp(info), false, JSON.stringify(info));
});

test("shell.pid stops this app only while that pid still runs", (t) => {
	const dir = mkdtempSync(path.join(tmpdir(), "godspeed-hand-over-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const pidFile = path.join(dir, "shell.pid");
	assert.equal(newerAppOpen(pidFile), false, "missing file");

	// The test runner that started this process still runs.
	writeFileSync(pidFile, `${process.ppid}\n`);
	assert.equal(newerAppOpen(pidFile), true, "a running pid");

	const dead = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
	writeFileSync(pidFile, `${dead.stdout}\n`);
	assert.equal(newerAppOpen(pidFile), false, "a pid that has exited");

	for (const text of ["", "abc", "0", "-1", "12.5", `${process.pid}\n`]) {
		writeFileSync(pidFile, text);
		assert.equal(newerAppOpen(pidFile), false, JSON.stringify(text));
	}
	rmSync(pidFile);
	assert.equal(newerAppOpen(dir), false, "unreadable (a folder)");
});

test("the notices use no em-dashes", () => {
	for (const notice of [OLD_MAC_NOTICE, NEW_APP_NOTICE, NEWER_APP_OPEN_NOTICE]) assert.doesNotMatch(JSON.stringify(notice), /—/);
});
