/**
 * The Files page's linked-folder line ("Watching CSE 21 on Google Drive ·
 * checked just now", or a plain warning instead), what its box says about
 * files it can't read, and the summary's "3 new since Tue".
 */
import { folderName, isGoogleDriveFolder, isNewFolderFile, type ClassFile, type FolderStatus, type SkippedFiles } from "@/shared/core";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The line, and whether it is a warning. */
export function folderStatusLine(folder: string, status: FolderStatus, now: number | null): { text: string; warn: boolean } {
	const drive = isGoogleDriveFolder(folder);
	if (status.problem === "missing") return { text: drive ? "Can't find this folder. Is Google Drive open?" : "Can't find this folder", warn: true };
	if (status.problem === "not-responding") {
		return { text: drive ? "Google Drive isn't responding. It may be paused or offline. Your files stay." : "This folder isn't responding. Your files stay.", warn: true };
	}
	if (status.problem === "empty") return { text: drive ? "Google Drive is starting, waiting to check" : "This folder looks empty, waiting to check", warn: true };
	const n = status.settling;
	if (n > 0) return { text: `${n} ${n === 1 ? "file" : "files"} still ${drive ? "downloading" : "being saved"}`, warn: false };
	const parts = [`Watching ${folderName(folder)}${drive ? " on Google Drive" : ""}`];
	const skipped = status.skipped?.count ?? 0;
	if (skipped > 0) parts.push(`${skipped} can't be read`);
	if (status.checkedAt && now !== null) parts.push(`checked ${checkedAgo(status.checkedAt, now)}`);
	return { text: parts.join(" · "), warn: false };
}

/** The linked-folder box's lines about files it can't read ("2 files here
 *  can't be read: notes.key, plan.gdoc"), and what to do about Google
 *  Docs; empty when every file can be read. */
export function skippedLines(skipped: SkippedFiles | undefined): string[] {
	if (!skipped || skipped.count === 0) return [];
	const { count, examples, google } = skipped;
	const more = count - examples.length;
	const names = more > 0 ? `${examples.join(", ")} and ${more} more` : examples.join(", ");
	const lines = [`${count} ${count === 1 ? "file here can't" : "files here can't"} be read: ${names}.`];
	if (google > 0) lines.push("Google Docs need saving as PDF or Word to be read.");
	return lines;
}

/** "just now", "4 minutes ago", "2 hours ago". */
function checkedAgo(at: string, now: number): string {
	const minutes = Math.floor((now - Date.parse(at)) / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
	const hours = Math.floor(minutes / 60);
	return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
}

/** "3 new since Tue" (the day the oldest new file came), null when none. */
export function newSince(files: readonly ClassFile[], now: number): string | null {
	const fresh = files.filter((f) => isNewFolderFile(f, now));
	if (fresh.length === 0) return null;
	const oldest = Math.min(...fresh.map((f) => Date.parse(f.addedAt)));
	return `${fresh.length} new since ${WEEKDAYS[new Date(oldest).getDay()]}`;
}
