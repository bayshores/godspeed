/**
 * The teacher's work on a space, in words: what the strip on a space page,
 * Today, the space's tab and Talk say while its files are read and after.
 * Pure.
 */
import { isFirstRound, isWaitingFile, type AgentAction, type FileCoverage, type SpaceDeadline, type SpaceFile, type SpaceSummary, type SpaceWork } from "@/shared/core";
import { clockText } from "@/frontend/components/top-bar/top-bar-model";

/** A finished round shows for a day. */
const SHOWN_MS = 24 * 60 * 60 * 1000;

/** How many files the unfolded strip lists. */
const FILES_SHOWN = 6;

type WorkState =
	/** Files wait and no agent is taking work. */
	| { kind: "waiting"; left: number }
	/** `current`: the file being read; `left`: the files after it. */
	| { kind: "reading"; building: boolean; current: string | null; left: number }
	| { kind: "grouping" }
	| { kind: "done"; read: number; failed: number; facts: number; deadlines: number; endedAt: string };

const files = (n: number) => `${n} file${n === 1 ? "" : "s"}`;

const isFresh = (work: SpaceWork | undefined, nowMs: number): work is SpaceWork & { endedAt: string } => !!work?.endedAt && nowMs - Date.parse(work.endedAt) < SHOWN_MS;

/** Whether a space page has anything to show before its progress is read. */
export function hasWork(i: { files: readonly SpaceFile[]; work: SpaceWork | undefined; nowMs: number }): boolean {
	return i.files.some(isWaitingFile) || isFresh(i.work, i.nowMs);
}

export function workState(i: {
	files: readonly SpaceFile[];
	work: SpaceWork | undefined;
	deadlines: readonly SpaceDeadline[];
	coverage: readonly FileCoverage[];
	grouping: boolean;
	teaching: boolean;
	nowMs: number;
}): WorkState | null {
	const waiting = i.files.filter(isWaitingFile);
	if (waiting.length > 0) {
		if (!i.teaching) return { kind: "waiting", left: waiting.length };
		const current = waiting.find((f) => f.status === "extracting");
		return { kind: "reading", building: isFirstRound(i.files, i.work), current: current?.name ?? null, left: waiting.length - (current ? 1 : 0) };
	}
	if (!isFresh(i.work, i.nowMs)) return null;
	if (i.grouping) return { kind: "grouping" };
	const round = i.files.filter((f) => i.work!.fileIds.includes(f.id));
	const read = round.filter((f) => f.status === "ready");
	const facts = new Map(i.coverage.map((c) => [c.fileId, c.facts]));
	return {
		kind: "done",
		read: read.length,
		failed: round.length - read.length,
		facts: read.reduce((sum, f) => sum + (facts.get(f.id) ?? 0), 0),
		deadlines: workDeadlines(i.deadlines, i.work).length,
		endedAt: i.work.endedAt,
	};
}

export function workTitle(state: WorkState, teacher: string): string {
	switch (state.kind) {
		case "waiting":
			return `${files(state.left)} ${state.left === 1 ? "is" : "are"} waiting for your agent`;
		case "reading":
			return state.building ? `${teacher} is building this space` : `${teacher} is reading new files`;
		case "grouping":
			return `${teacher} is grouping the facts into topics`;
		case "done":
			return state.read > 0 ? `${teacher} read ${files(state.read)}` : `${teacher} could not read ${files(state.failed)}`;
	}
}

/** The second line, or null when the title says it all. */
export function workDetail(state: WorkState): string | null {
	switch (state.kind) {
		case "waiting":
		case "grouping":
			return null;
		case "reading":
			if (!state.current) return `${files(state.left)} left.`;
			return `Reading ${state.current} now. ${state.left === 0 ? "It is the last file." : `${state.left} left.`}`;
		case "done": {
			const made = [state.facts > 0 ? `${state.facts} fact${state.facts === 1 ? "" : "s"}` : "", state.deadlines > 0 ? `${state.deadlines} deadline${state.deadlines === 1 ? "" : "s"}` : ""].filter(Boolean);
			const failed = state.read > 0 && state.failed > 0 ? `${files(state.failed)} could not be read.` : "";
			return [made.length ? `${made.join(" and ")} added.` : "", failed, `Finished at ${clockText(new Date(state.endedAt))}.`].filter(Boolean).join(" ");
		}
	}
}

interface WorkFileRow {
	id: string;
	name: string;
	/** "9 facts", "reading now", "waiting", "could not be read". */
	note: string;
}

function fileNote(file: SpaceFile, coverage: FileCoverage | undefined): string {
	if (file.status === "extracting") return "reading now";
	if (file.status === "pending") return "waiting";
	if (file.status !== "ready") return "could not be read";
	if (file.kind === "info") return "space info";
	if (file.transcriptId) return "uses its transcript";
	if (!coverage) return "read";
	return `${coverage.facts} fact${coverage.facts === 1 ? "" : "s"}`;
}

/** The round's files: the one being read, then the finished ones (newest
 *  first), then the ones waiting. `more`: how many are not listed. */
export function workFiles(all: readonly SpaceFile[], work: SpaceWork | undefined, coverage: readonly FileCoverage[]): { rows: WorkFileRow[]; more: number } {
	const byId = new Map(all.map((f) => [f.id, f]));
	const finished = (work?.fileIds ?? []).flatMap((id) => byId.get(id) ?? []).filter((f) => !isWaitingFile(f)).reverse();
	const waiting = all.filter(isWaitingFile);
	const round = [...waiting.filter((f) => f.status === "extracting"), ...finished, ...waiting.filter((f) => f.status === "pending")];
	const facts = new Map(coverage.map((c) => [c.fileId, c]));
	return {
		rows: round.slice(0, FILES_SHOWN).map((f) => ({ id: f.id, name: f.name, note: fileNote(f, facts.get(f.id)) })),
		more: Math.max(0, round.length - FILES_SHOWN),
	};
}

/** The deadlines added in the round that are still there. */
export function workDeadlines(deadlines: readonly SpaceDeadline[], work: SpaceWork | undefined): SpaceDeadline[] {
	return deadlines.filter((d) => work?.deadlineIds.includes(d.id));
}

type LiveSpace = Pick<SpaceSummary, "name" | "filesLeft" | "building">;

/** Today's line for a space whose files are being read; null otherwise. */
export function todayWorkLine(space: LiveSpace, teacher: string, teaching: boolean): string | null {
	if (space.filesLeft === 0) return null;
	if (!teaching) return `${files(space.filesLeft)} in ${space.name} ${space.filesLeft === 1 ? "is" : "are"} waiting for your agent`;
	return `${teacher} is ${space.building ? "building" : "reading new files in"} ${space.name}. ${space.filesLeft} left.`;
}

/** The tag on the space's tab in the top bar. */
export function tabWorkTag(space: Pick<SpaceSummary, "filesLeft">): string | null {
	return space.filesLeft > 0 ? `${space.filesLeft} left` : null;
}

/** The line under Talk's "Created <space>" row while that space is read;
 *  `action` is the row's change as the panel knows it. */
export function talkWorkLine(action: AgentAction | null, spaces: readonly SpaceSummary[], teaching: boolean): string | null {
	if (action?.target?.kind !== "space" || !action.label.startsWith("Creating ")) return null;
	const left = spaces.find((s) => s.id === action.target?.id)?.filesLeft ?? 0;
	if (left === 0) return null;
	return teaching ? `Reading its files, ${left} left` : `${files(left)} ${left === 1 ? "is" : "are"} waiting for your agent`;
}
