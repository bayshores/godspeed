import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { bugReportURL } = require("../electron/bug-report.cjs");

test("bug report link opens a new issue with the template, version and OS", () => {
	const url = new URL(bugReportURL({ version: "0.5.0", platform: "darwin", systemVersion: "26.0.1", arch: "arm64" }));
	assert.equal(url.origin + url.pathname, "https://github.com/bayshores/godspeed/issues/new");
	assert.deepEqual([...url.searchParams.keys()], ["body"]);
	assert.equal(url.searchParams.get("body"), [
		"### What happened", "",
		"### What you expected", "",
		"### Steps to reproduce", "",
		"---",
		"godspeed 0.5.0 · macOS 26.0.1 arm64",
	].join("\n"));
});

test("bug report names Windows and Linux", () => {
	const os = (platform: string) => new URL(bugReportURL({ version: "1.0.0", platform, systemVersion: "10.0", arch: "x64" })).searchParams.get("body")?.split("\n").at(-1);
	assert.equal(os("win32"), "godspeed 1.0.0 · Windows 10.0 x64");
	assert.equal(os("linux"), "godspeed 1.0.0 · Linux 10.0 x64");
});
