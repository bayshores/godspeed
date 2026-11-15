/**
 * Files new to a space: how long a file a folder scan found counts as new.
 */
import type { SpaceFile } from "./contracts.ts";

/** How long an arrived file counts as new (the Files page's New mark and the
 *  agent's [Today] note). */
const NEW_FILE_DAYS = 3;
const NEW_FILE_MS = NEW_FILE_DAYS * 86_400_000;

/** How long an added or removed file shows in the Files page's Recent
 *  changes (and a removed one stays on the space record). */
export const RECENT_CHANGE_DAYS = 14;

/** True when the time is within the last RECENT_CHANGE_DAYS. */
export function isRecentChange(at: string, now: number): boolean {
	return now - Date.parse(at) <= RECENT_CHANGE_DAYS * 86_400_000;
}

/** True when the time is within the last NEW_FILE_DAYS. */
export function isRecent(at: string | undefined, now: number): boolean {
	return !!at && now - Date.parse(at) <= NEW_FILE_MS;
}

/** A file a later scan of its linked folder found, in the last few days. */
export function isNewFolderFile(file: Pick<SpaceFile, "foundByScan" | "addedAt">, now: number): boolean {
	return file.foundByScan === true && isRecent(file.addedAt, now);
}

