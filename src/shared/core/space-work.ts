/**
 * A round of the teacher's work on a space: it opens when a study file
 * starts waiting to be read and ends when none waits. Pure, so the store
 * can apply it on every file write.
 */

import type { SpaceFile } from "./contracts.ts";

/** A study file the teacher still has to read. */
export function isWaitingFile(file: Pick<SpaceFile, "kind" | "status">): boolean {
	return file.kind === "study" && (file.status === "pending" || file.status === "extracting");
}

