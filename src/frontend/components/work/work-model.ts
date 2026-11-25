/**
 * Background work on a space, in words: what the work frame on a space
 * page, Home, the space's tab and the strip say while its
 * files are read, and the notice after. Pure.
 */
import { isWaitingFile, type SpaceFile, type SpaceSummary, type SpaceWork } from "@/shared/core";
import { backgroundLine } from "@/frontend/components/teacher/follow-status";

/** A finished round shows for a day. */
const SHOWN_MS = 24 * 60 * 60 * 1000;

type WorkState =
	/** `read`: the round's files finished so far; `total`: those and the ones still waiting. */
	| { kind: "reading"; read: number; total: number }
	| { kind: "grouping" };

export const files = (n: number) => `${n} file${n === 1 ? "" : "s"}`;

type ProgressSpace = Pick<SpaceSummary, "filesLeft" | "filesRead" | "closed">;

/** The spaces whose files are being read, with the files read so far and
 *  the ones left, over all of them. */
export function filesProgress<S extends ProgressSpace>(spaces: readonly S[]): { live: S[]; read: number; left: number } {
	const live = spaces.filter((s) => !s.closed && s.filesLeft > 0);
	return { live, read: live.reduce((sum, s) => sum + (s.filesRead ?? 0), 0), left: live.reduce((sum, s) => sum + s.filesLeft, 0) };
}

const isFresh = (work: SpaceWork | undefined, nowMs: number): work is SpaceWork & { endedAt: string } => !!work?.endedAt && nowMs - Date.parse(work.endedAt) < SHOWN_MS;

/** Null while no file waits and no grouping runs. */
export function workState(i: { files: readonly SpaceFile[]; work: SpaceWork | undefined; grouping: boolean }): WorkState | null {
	const waiting = i.files.filter(isWaitingFile).length;
	if (waiting > 0) {
		const read = i.work?.endedAt ? 0 : (i.work?.fileIds.length ?? 0);
		return { kind: "reading", read, total: read + waiting };
	}
	return i.grouping ? { kind: "grouping" } : null;
}

/** What the last round read, for the notice, for a day after it
 *  ended; null while files wait or the round had no file. */
export function readNews(i: { files: readonly SpaceFile[]; work: SpaceWork | undefined; nowMs: number }, teacher: string): string | null {
	if (i.files.some(isWaitingFile) || !isFresh(i.work, i.nowMs)) return null;
	const round = i.files.filter((f) => i.work!.fileIds.includes(f.id));
	const read = round.filter((f) => f.status === "ready").length;
	const failed = round.length - read;
	if (round.length === 0) return null;
	if (read === 0) return `${teacher} could not read ${files(failed)}.`;
	return failed > 0 ? `${teacher} read ${files(read)} and could not read ${failed}.` : `${teacher} read ${files(read)}.`;
}

/** What the work frame says. */
interface FrameWords {
	text: string;
	count: string;
}

/** The frame of a page at work: `count` says how far, or what a job on it does. */
export const workFrame = (count: string): FrameWords => ({ text: "Working on this page", count });

/** The frame of a space page. While it works it names no reader. */
export function spaceFrame(state: WorkState): FrameWords {
	switch (state.kind) {
		case "reading":
			return workFrame(`${state.read} of ${files(state.total)}`);
		case "grouping":
			return workFrame("grouping facts into topics");
	}
}

/** The tag on the space's tab in the top bar. */
export function tabWorkTag(space: Pick<SpaceSummary, "filesLeft">): string | null {
	return space.filesLeft > 0 ? `${space.filesLeft} left` : null;
}

/** Background work, for the strip: what it is and how far it is. */
export interface WorkProgress {
	doing: string;
	count: string | null;
}

/**
 * The background work under way on every page, named: "Reading files",
 * "6 of 17" while files are read, else the run or job in progress
 * (backgroundLine), else a deadline's or plugin's request by its name
 * ("Deadline: Wave Optics Final", "Memes"). Null when nothing runs.
 */
export function workProgress(i: {
	spaces: readonly ProgressSpace[];
	extractions: Parameters<typeof backgroundLine>[0];
	jobs: Parameters<typeof backgroundLine>[1];
	requests: readonly string[];
}): WorkProgress | null {
	const { live, read, left } = filesProgress(i.spaces);
	if (live.length > 0) return { doing: "Reading files", count: `${read} of ${read + left}` };
	const line = backgroundLine(i.extractions, i.jobs);
	if (line) return { doing: line.text, count: line.count ?? null };
	const request = i.requests[0];
	return request === undefined ? null : { doing: request, count: null };
}
