/**
 * A round of the teacher's work on a space: it opens when a study file
 * starts waiting to be read and ends when none waits. Pure, so the store
 * can apply it on every file write.
 */

import type { SpaceFile, SpaceWork } from "./contracts.ts";

/** A study file the teacher still has to read. */
export function isWaitingFile(file: Pick<SpaceFile, "kind" | "status">): boolean {
	return file.kind === "study" && (file.status === "pending" || file.status === "extracting");
}

const isOpen = (work: SpaceWork | undefined): work is SpaceWork => !!work && !work.endedAt;

/**
 * The round after a file write: `before` is the list as stored, `after`
 * the list being saved. A file that stops waiting joins the round; a round
 * that made nothing leaves no trace.
 */
export function workAfterFiles(work: SpaceWork | undefined, before: readonly SpaceFile[], after: readonly SpaceFile[], now: string): SpaceWork | undefined {
	const waiting = after.some(isWaitingFile);
	if (!isOpen(work)) return waiting ? { startedAt: now, fileIds: [], deadlineIds: [] } : work;
	const waited = new Set(before.filter(isWaitingFile).map((f) => f.id));
	const finished = after.filter((f) => waited.has(f.id) && !isWaitingFile(f) && !work.fileIds.includes(f.id)).map((f) => f.id);
	const fileIds = [...work.fileIds, ...finished];
	if (waiting) return { ...work, fileIds };
	return fileIds.length || work.deadlineIds.length ? { ...work, fileIds, endedAt: now } : undefined;
}

/** A deadline added while a round is open belongs to it. */
export function workAfterDeadline(work: SpaceWork | undefined, deadlineId: string): SpaceWork | undefined {
	return isOpen(work) ? { ...work, deadlineIds: [...work.deadlineIds, deadlineId] } : work;
}
