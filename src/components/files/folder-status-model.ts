/**
 * The Files page's linked-folder line ("Watching CSE 21 on Google Drive ·
 * checked just now", or a plain warning instead) and the summary's
 * "3 new since Tue".
 */
import { folderName, isGoogleDriveFolder, isNewFolderFile, type ClassFile, type FolderStatus } from "@/core";

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
	const watching = `Watching ${folderName(folder)}${drive ? " on Google Drive" : ""}`;
	return { text: status.checkedAt && now !== null ? `${watching} · checked ${checkedAgo(status.checkedAt, now)}` : watching, warn: false };
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
