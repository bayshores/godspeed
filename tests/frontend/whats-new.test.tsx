/**
 * "What's new" after an update: the version math, the shipped changelog's
 * shape, the settings field and the dialog's markup.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import * as fs from "node:fs";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

const { CHANGELOG, compareVersions, entriesSince, entryFor, sanitizeUserSettings } = await import("../../src/shared/core/index.ts");
const { WhatsNewDialog, formatChangelogDate } = await import("../../src/frontend/components/whats-new-dialog.tsx");
const pkg = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };

const NOTES = [
	{ version: "0.4.3", date: "2026-11-20", changes: ["Third."] },
	{ version: "0.4.2", date: "2026-11-10", changes: ["Second."] },
	{ version: "0.4.1", date: "2026-11-01", changes: ["First."] },
	{ version: "0.4.0", date: "2026-10-27", changes: ["Base."] },
];

describe("version math", () => {
	it("compares numerically, not as text", () => {
		assert.ok(compareVersions("0.4.10", "0.4.9") > 0);
		assert.ok(compareVersions("0.10.0", "0.9.9") > 0);
		assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
		assert.ok(compareVersions("junk", "0.0.1") < 0);
	});

	it("lists every skipped version, newest first, up to the running one", () => {
		assert.deepEqual(entriesSince("0.4.0", "0.4.3", NOTES).map((e) => e.version), ["0.4.3", "0.4.2", "0.4.1"]);
		assert.deepEqual(entriesSince("0.4.1", "0.4.2", NOTES).map((e) => e.version), ["0.4.2"]);
		assert.deepEqual(entriesSince("0.4.3", "0.4.3", NOTES), []);
		assert.equal(entryFor("0.4.2", NOTES)?.changes[0], "Second.");
		assert.equal(entryFor("9.9.9", NOTES), null);
	});
});

describe("the shipped changelog", () => {
	it("is newest first, well formed, and covers the app's version", () => {
		assert.ok(CHANGELOG.length > 0);
		for (const entry of CHANGELOG) {
			assert.match(entry.version, /^\d+\.\d+\.\d+$/);
			assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/);
			assert.ok(entry.changes.length > 0 && entry.changes.every((c) => typeof c === "string" && c.trim().length > 0));
		}
		for (let i = 1; i < CHANGELOG.length; i++) {
			assert.ok(compareVersions(CHANGELOG[i - 1]!.version, CHANGELOG[i]!.version) > 0, "newest first, no duplicates");
		}
		assert.ok(entryFor(pkg.version), `src/shared/changelog.json needs notes for ${pkg.version}`);
	});
});

describe("the lastSeenVersion setting", () => {
	it("the sanitizer keeps a version and drops anything else", () => {
		assert.equal(sanitizeUserSettings({ version: 1, general: { lastSeenVersion: "0.4.1" } })?.general?.lastSeenVersion, "0.4.1");
		assert.equal(sanitizeUserSettings({ version: 1, general: { lastSeenVersion: "nope" } })?.general?.lastSeenVersion, undefined);
	});
});

describe("the dialog", () => {
	it("one version: titled with it, its date, and its changes", () => {
		const html = renderToStaticMarkup(<WhatsNewDialog entries={[NOTES[2]!]} state="open" onClose={() => {}} />);
		assert.match(html, /What&#x27;s new in 0\.4\.1/);
		assert.match(html, /Nov 1, 2026/);
		assert.match(html, /First\./);
		assert.match(html, /Got it/);
		assert.match(html, /role="dialog"/);
	});

	it("several versions: one section per version, newest first", () => {
		const html = renderToStaticMarkup(<WhatsNewDialog entries={NOTES.slice(0, 3)} state="open" onClose={() => {}} />);
		assert.match(html, /aria-label="What&#x27;s new"/);
		const order = ["0.4.3", "0.4.2", "0.4.1"].map((v) => html.indexOf(`${v}, `));
		assert.ok(order.every((i) => i >= 0) && order[0]! < order[1]! && order[1]! < order[2]!);
	});

	it("formats dates without a time zone shift", () => {
		assert.equal(formatChangelogDate("2026-10-27"), "Oct 27, 2026");
		assert.equal(formatChangelogDate("bad"), "bad");
	});
});
