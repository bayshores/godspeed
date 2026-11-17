/**
 * Background work on a space, in words: what the work frame on a space
 * page, Today, the space's tab and the top bar pill say while its
 * files are read, and the pill's notice after. Pure.
 */
import { isWaitingFile, type SpaceFile, type SpaceSummary, type SpaceWork } from "@/shared/core";
import type { AgentStatus } from "@/frontend/components/agent-status";

/** A finished round shows for a day. */
const SHOWN_MS = 24 * 60 * 60 * 1000;

export const HELPER_NAME = "Background work";

/** Who does the background work: the helper when one is open, else the
 *  teacher; null when no agent takes work. Before the first read of the
 *  agent's state it is the teacher. */
export function workerName(agent: Pick<AgentStatus, "teaching" | "helperHere"> | null, teacher: string): string | null {
	if (agent?.helperHere) return HELPER_NAME;
	return !agent || agent.teaching ? teacher : null;
}

type WorkState =
	/** Files wait and no agent takes work. */
	| { kind: "waiting"; left: number }
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

export function workState(i: { files: readonly SpaceFile[]; work: SpaceWork | undefined; grouping: boolean; working: boolean }): WorkState | null {
	const waiting = i.files.filter(isWaitingFile).length;
	if (waiting > 0) {
		if (!i.working) return { kind: "waiting", left: waiting };
		const read = i.work?.endedAt ? 0 : (i.work?.fileIds.length ?? 0);
		return { kind: "reading", read, total: read + waiting };
	}
	return i.grouping && i.working ? { kind: "grouping" } : null;
}

/** What the last round read, for the pill's notice, for a day after it
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
	state: "working" | "waiting";
	text: string;
	count: string | null;
}

const working = (count: string): FrameWords => ({ state: "working", text: "Working on this page", count });

/** The frame of a space page. While it works it names no reader: the
 *  teacher and the helper may each read some of it. */
export function spaceFrame(state: WorkState, teacher: string): FrameWords {
	switch (state.kind) {
		case "waiting":
			return { state: "waiting", text: `${files(state.left)} ${state.left === 1 ? "is" : "are"} waiting. Turn on ${teacher} to read ${state.left === 1 ? "it" : "them"}.`, count: null };
		case "reading":
			return working(`${state.read} of ${files(state.total)}`);
		case "grouping":
			return working("grouping facts into topics");
	}
}

/** The frame of a page one job works on (a lesson, a cheat sheet): what,
 *  or that it waits for the teacher. */
export function jobFrame(worker: string | null, doing: string, teacher: string): FrameWords {
	return worker ? working(doing) : { state: "waiting", text: `This page is waiting. Turn on ${teacher} to carry on.`, count: null };
}

type LiveSpace = Pick<SpaceSummary, "filesLeft" | "building">;

/** The chip on a space's row on Today while its files are read; null
 *  otherwise. With no reader it only says they wait: the top bar says why. */
export function todayWorkLine(space: LiveSpace, worker: string | null): string | null {
	if (space.filesLeft === 0) return null;
	if (!worker) return `${files(space.filesLeft)} ${space.filesLeft === 1 ? "is" : "are"} waiting`;
	return `${space.building ? "Building" : "Reading new files"}, ${space.filesLeft} left`;
}

/** The tag on the space's tab in the top bar. */
export function tabWorkTag(space: Pick<SpaceSummary, "filesLeft">): string | null {
	return space.filesLeft > 0 ? `${space.filesLeft} left` : null;
}

/** Background work, for the pill: what it is, how far it is, and its
 *  short form as a tag. */
export interface WorkProgress {
	doing: string;
	count: string | null;
	tag: string;
}

/**
 * The background work under way on every page: "Reading files", "6 of 17"
 * while files are read, a request's name when it is the
 * only work, else the number of jobs. `requests`: the deadline and plugin
 * requests' names ("Deadline: Wave Optics Final", "Memes"), not counted in `jobs`. Null when
 * nothing runs or no agent takes the work.
 */
export function workProgress(i: { worker: string | null; spaces: readonly ProgressSpace[]; jobs: number; requests: readonly string[] }): WorkProgress | null {
	if (!i.worker) return null;
	const { live, read, left } = filesProgress(i.spaces);
	if (live.length > 0) return { doing: "Reading files", count: `${read} of ${read + left}`, tag: `${read} of ${files(read + left)}` };
	const [request, ...more] = i.requests;
	if (i.jobs === 0 && request !== undefined && more.length === 0) return { doing: request, count: null, tag: request };
	const all = i.jobs + i.requests.length;
	if (all === 0) return null;
	const jobs = `${all} job${all === 1 ? "" : "s"}`;
	return { doing: `Working on ${jobs}`, count: null, tag: jobs };
}
