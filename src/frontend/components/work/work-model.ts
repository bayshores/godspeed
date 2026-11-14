/**
 * Background work on a space, in words: what the work frame on a space
 * page, Today, the space's tab, the top bar chip and Talk say while its
 * files are read and after. Pure.
 */
import { isWaitingFile, type AgentAction, type SpaceFile, type SpaceSummary, type SpaceWork } from "@/shared/core";
import type { AgentStatus } from "@/frontend/components/agent-status";

/** A finished round shows for a day. */
const SHOWN_MS = 24 * 60 * 60 * 1000;

export const HELPER_NAME = "Helper";

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
	| { kind: "grouping" }
	| { kind: "done"; read: number; failed: number };

export const files = (n: number) => `${n} file${n === 1 ? "" : "s"}`;

type ProgressSpace = Pick<SpaceSummary, "filesLeft" | "filesRead" | "closed">;

/** The spaces whose files are being read, with the files read so far and
 *  the ones left, over all of them. */
export function filesProgress<S extends ProgressSpace>(spaces: readonly S[]): { live: S[]; read: number; left: number } {
	const live = spaces.filter((s) => !s.closed && s.filesLeft > 0);
	return { live, read: live.reduce((sum, s) => sum + (s.filesRead ?? 0), 0), left: live.reduce((sum, s) => sum + s.filesLeft, 0) };
}

const isFresh = (work: SpaceWork | undefined, nowMs: number): work is SpaceWork & { endedAt: string } => !!work?.endedAt && nowMs - Date.parse(work.endedAt) < SHOWN_MS;

export function workState(i: { files: readonly SpaceFile[]; work: SpaceWork | undefined; grouping: boolean; working: boolean; nowMs: number }): WorkState | null {
	const waiting = i.files.filter(isWaitingFile).length;
	if (waiting > 0) {
		if (!i.working) return { kind: "waiting", left: waiting };
		const read = i.work?.endedAt ? 0 : (i.work?.fileIds.length ?? 0);
		return { kind: "reading", read, total: read + waiting };
	}
	if (i.grouping) return i.working ? { kind: "grouping" } : null;
	if (!isFresh(i.work, i.nowMs)) return null;
	const round = i.files.filter((f) => i.work!.fileIds.includes(f.id));
	const read = round.filter((f) => f.status === "ready").length;
	return { kind: "done", read, failed: round.length - read };
}

/** What the work frame says. */
interface FrameWords {
	state: "working" | "waiting" | "done";
	text: string;
	count: string | null;
}

const working = (worker: string, count: string): FrameWords => ({ state: "working", text: `${worker} is working on this page`, count });

/** The frame of a space page; `worker` is who reads. A finished round names no window: the
 *  teacher and the helper may each have read some of it. */
export function spaceFrame(state: WorkState, worker: string): FrameWords {
	switch (state.kind) {
		case "waiting":
			return { state: "waiting", text: `${files(state.left)} ${state.left === 1 ? "is" : "are"} waiting. Open your agent to read ${state.left === 1 ? "it" : "them"}.`, count: null };
		case "reading":
			return working(worker, `${state.read} of ${files(state.total)}`);
		case "grouping":
			return working(worker, "grouping facts into topics");
		case "done":
			if (state.read === 0) return { state: "done", text: `Your agent could not read ${files(state.failed)}.`, count: null };
			return { state: "done", text: `Your agent read ${files(state.read)}.`, count: state.failed > 0 ? `${state.failed} could not be read` : null };
	}
}

/** The frame of a page one job works on (a lesson, a cheat sheet): who
 *  and what, or that it waits for an agent. */
export function jobFrame(worker: string | null, doing: string): FrameWords {
	return worker ? working(worker, doing) : { state: "waiting", text: "This page is waiting. Open your agent to carry on.", count: null };
}

type LiveSpace = Pick<SpaceSummary, "filesLeft" | "building">;

/** The chip on a space's row on Today while its files are read; null otherwise. */
export function todayWorkLine(space: LiveSpace, worker: string | null): string | null {
	if (space.filesLeft === 0) return null;
	if (!worker) return `${files(space.filesLeft)} ${space.filesLeft === 1 ? "is" : "are"} waiting for your agent`;
	return `${worker} is ${space.building ? "building it" : "reading new files"}, ${space.filesLeft} left`;
}

/** The tag on the space's tab in the top bar. */
export function tabWorkTag(space: Pick<SpaceSummary, "filesLeft">): string | null {
	return space.filesLeft > 0 ? `${space.filesLeft} left` : null;
}

/**
 * The top bar's work chip, on every page while background work runs:
 * "Helper, 6 of 17 files" while files are read, else the number of jobs.
 * Null when nothing runs or no agent takes the work.
 */
export function workChip(i: { worker: string | null; spaces: readonly ProgressSpace[]; jobs: number }): string | null {
	if (!i.worker) return null;
	const { live, read, left } = filesProgress(i.spaces);
	if (live.length > 0) return `${i.worker}, ${read} of ${files(read + left)}`;
	return i.jobs > 0 ? `${i.worker}, ${i.jobs} job${i.jobs === 1 ? "" : "s"}` : null;
}

/** The line under Talk's "Created <space>" row while that space is read;
 *  `action` is the row's change as the panel knows it. */
export function talkWorkLine(action: AgentAction | null, spaces: readonly SpaceSummary[], working: boolean): string | null {
	if (action?.target?.kind !== "space" || !action.label.startsWith("Creating ")) return null;
	const left = spaces.find((s) => s.id === action.target?.id)?.filesLeft ?? 0;
	if (left === 0) return null;
	return working ? `Reading its files, ${left} left` : `${files(left)} ${left === 1 ? "is" : "are"} waiting for your agent`;
}
