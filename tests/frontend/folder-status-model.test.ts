/**
 * The Files page's linked-folder line and "N new since Tue", and how a
 * folder's name and source are read from its path.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClassFile, FolderStatus } from "../../src/shared/core/contracts.ts";
import { folderName, folderSource, isGoogleDriveFolder } from "../../src/shared/core/linked-folder.ts";
import { folderStatusLine, newSince, skippedLines } from "../../src/frontend/components/files/folder-status-model.ts";

const DRIVE = "/Users/me/Library/CloudStorage/GoogleDrive-me@gmail.com/My Drive/CSE 21";
const LOCAL = "/Users/me/School/CSE 21/";
const NOW = Date.parse("2026-11-01T12:00:00Z");
const ok = (over: Partial<FolderStatus> = {}): FolderStatus => ({ problem: null, checkedAt: new Date(NOW - 20_000).toISOString(), settling: 0, ...over });

describe("linked folder names", () => {
	it("knows a Google Drive folder and names a folder by its last segment", () => {
		assert.equal(isGoogleDriveFolder(DRIVE), true);
		assert.equal(isGoogleDriveFolder(LOCAL), false);
		assert.equal(isGoogleDriveFolder("/Users/me/Library/CloudStorage/Dropbox/CSE 21"), false);
		assert.equal(folderName(LOCAL), "CSE 21");
		assert.deepEqual([folderSource(DRIVE), folderSource(LOCAL)], ["Google Drive", "CSE 21"]);
	});
});

describe("the folder line", () => {
	it("says what it watches and when it last checked", () => {
		assert.deepEqual(folderStatusLine(DRIVE, ok(), NOW), { text: "Watching CSE 21 on Google Drive, checked just now", warn: false });
		assert.equal(folderStatusLine(LOCAL, ok({ checkedAt: new Date(NOW - 4 * 60_000).toISOString() }), NOW).text, "Watching CSE 21, checked 4 minutes ago");
		assert.equal(folderStatusLine(LOCAL, ok({ checkedAt: new Date(NOW - 61 * 60_000).toISOString() }), NOW).text, "Watching CSE 21, checked 1 hour ago");
		assert.equal(folderStatusLine(LOCAL, ok({ checkedAt: null }), NOW).text, "Watching CSE 21");
		assert.equal(folderStatusLine(LOCAL, ok(), null).text, "Watching CSE 21");
	});

	it("counts files it can't read, and its box names them", () => {
		const skipped = { count: 5, examples: ["notes.key", "Plan.gdoc", "photo.png"], google: 1 };
		assert.equal(folderStatusLine(DRIVE, ok({ skipped }), NOW).text, "Watching CSE 21 on Google Drive, 5 can't be read, checked just now");
		assert.deepEqual(skippedLines(skipped), [
			"5 files here can't be read: notes.key, Plan.gdoc, photo.png and 2 more.",
			"Google Docs need saving as PDF or Word to be read.",
		]);
		assert.deepEqual(skippedLines({ count: 1, examples: ["notes.key"], google: 0 }), ["1 file here can't be read: notes.key."]);
		assert.deepEqual(skippedLines(undefined), []);
	});

	it("gives plain warnings instead when the folder is gone, looks empty or is still downloading", () => {
		assert.deepEqual(folderStatusLine(DRIVE, ok({ problem: "missing" }), NOW), { text: "Can't find this folder. Is Google Drive open?", warn: true });
		assert.equal(folderStatusLine(LOCAL, ok({ problem: "missing" }), NOW).text, "Can't find this folder");
		assert.deepEqual(folderStatusLine(DRIVE, ok({ problem: "not-responding" }), NOW), { text: "Google Drive isn't responding. It may be paused or offline. Your files stay.", warn: true });
		assert.equal(folderStatusLine(LOCAL, ok({ problem: "not-responding" }), NOW).text, "This folder isn't responding. Your files stay.");
		assert.equal(folderStatusLine(DRIVE, ok({ problem: "empty" }), NOW).text, "Google Drive is starting, waiting to check");
		assert.equal(folderStatusLine(LOCAL, ok({ problem: "empty" }), NOW).text, "This folder looks empty, waiting to check");
		assert.deepEqual(folderStatusLine(DRIVE, ok({ settling: 3 }), NOW), { text: "3 files still downloading", warn: false });
		assert.equal(folderStatusLine(LOCAL, ok({ settling: 1 }), NOW).text, "1 file still being saved");
	});
});

describe("new since", () => {
	const file = (id: string, addedAt: string, foundByScan = true): ClassFile => ({
		id, origin: "linked", name: id, path: id, kind: "study", contentFp: "", status: "ready", addedAt, ...(foundByScan ? { foundByScan: true as const } : {}),
	});
	it("counts files a scan found in the last 3 days, since the day the oldest came", () => {
		const files = [
			file("a", new Date(NOW - 2 * 86_400_000).toISOString()),
			file("b", new Date(NOW - 3_600_000).toISOString()),
			file("c", new Date(NOW - 5 * 86_400_000).toISOString()),
			file("d", new Date(NOW - 3_600_000).toISOString(), false),
		];
		const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(NOW - 2 * 86_400_000).getDay()];
		assert.equal(newSince(files, NOW), `2 new since ${day}`);
		assert.equal(newSince(files.slice(2), NOW), null);
	});
});
