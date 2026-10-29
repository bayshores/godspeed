/** Pure helpers for Home's per-class progress (home-page.tsx). */
import type { ProgressPayload } from "@/core";

export interface ClassesProgress {
	/** The latest payload each class has had. */
	progress: ReadonlyMap<string, ProgressPayload>;
	/** Why a class's last read failed. */
	errors: ReadonlyMap<string, string>;
}

export type ProgressRead = { classId: string; payload: ProgressPayload } | { classId: string; error: string };

/** One round of reads on top of the last state. A failed read keeps the
 *  class's earlier payload, so a blip never blanks a card that had data. */
export function foldClassesProgress(prev: ClassesProgress, classIds: readonly string[], reads: readonly ProgressRead[]): ClassesProgress {
	const progress = new Map<string, ProgressPayload>();
	const errors = new Map<string, string>();
	for (const classId of classIds) {
		const read = reads.find((r) => r.classId === classId);
		const payload = read && "payload" in read ? read.payload : prev.progress.get(classId);
		if (payload) progress.set(classId, payload);
		if (read && "error" in read) errors.set(classId, read.error);
	}
	return { progress, errors };
}

/** Every class has either data or a failed read, so no card waits on another. */
export function classesSettled(classIds: readonly string[], state: ClassesProgress): boolean {
	return classIds.every((id) => state.progress.has(id) || state.errors.has(id));
}

/** What a class's slot shows. Until the blocks are ready they all show the
 *  loading box, so they fill in together. */
export function classSlot(classId: string, state: ClassesProgress, blocksReady: boolean): "block" | "failed" | "loading" {
	if (!blocksReady) return "loading";
	if (state.progress.has(classId)) return "block";
	return state.errors.has(classId) ? "failed" : "loading";
}
