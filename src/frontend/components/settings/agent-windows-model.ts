/**
 * Settings → Connection, "Your agent": what the Teacher and Helper window
 * tiles say. Pure.
 */
import type { SpaceSummary } from "@/shared/core";
import { teachStep, type AgentStatus } from "@/frontend/components/agent-status";
import type { AgentDoing } from "@/frontend/components/teacher/follow-status";

export interface WindowTile {
	/** on: open. busy: working (striped edge). off: closed. */
	tone: "on" | "busy" | "off";
	chip: string;
	line: string;
	note: string;
	/** The tile's button, when the window is closed. */
	open: string | null;
}

type Agent = Pick<AgentStatus, "connected" | "teaching" | "name" | "helperHere" | "helperCovering" | "pendingTurns">;

/** The teacher's window is open: it teaches, or it connected and has not started. */
const teacherOpen = (agent: Agent) => agent.teaching || (agent.connected && !agent.helperHere);

export function windowsHeadline(agent: Agent): string {
	const teacher = teacherOpen(agent);
	if (teacher && agent.helperHere) return "Both windows are open";
	if (teacher) return "The teacher window is open";
	return agent.helperHere ? "Only the helper window is open" : "No window is open";
}

export function teacherTile(agent: Agent, doing: AgentDoing | null): WindowTile {
	const note = "Teaches and answers you";
	if (agent.helperCovering) return { tone: "on", chip: "Teaching", line: "Tidying its memory", note: "The helper answers for a minute", open: null };
	if (agent.teaching) return { tone: "on", chip: "Teaching", line: doing?.working ? doing.text : "Nothing to do right now", note, open: null };
	if (teacherOpen(agent)) return { tone: "on", chip: "Open", line: teachStep(agent.name), note, open: null };
	return { tone: "off", chip: "Closed", line: agent.pendingTurns > 0 ? "Your lesson is waiting" : "Not open", note: "Open it and it starts teaching", open: "Open teacher" };
}

const files = (n: number) => `${n} file${n === 1 ? "" : "s"}`;

/** "6 of 17 files in Machine Learning", over every space being read; null when none is. */
export function filesLine(spaces: readonly Pick<SpaceSummary, "name" | "filesLeft" | "filesRead" | "archived">[]): string | null {
	const live = spaces.filter((s) => !s.archived && s.filesLeft > 0);
	if (live.length === 0) return null;
	const read = live.reduce((sum, s) => sum + (s.filesRead ?? 0), 0);
	const left = live.reduce((sum, s) => sum + s.filesLeft, 0);
	return `${read} of ${files(read + left)} in ${live.length === 1 ? live[0]!.name : `${live.length} spaces`}`;
}

export function helperTile(i: {
	agent: Agent;
	/** The background work under way, in words (backgroundLine). */
	background: { text: string; count?: string } | null;
	/** filesLine of the spaces. */
	files: string | null;
	filesLeft: number;
	teacher: string;
}): WindowTile {
	const { agent } = i;
	if (!agent.helperHere) {
		const waiting = i.filesLeft > 0;
		return {
			tone: "off",
			chip: "Closed",
			line: waiting ? `${files(i.filesLeft)} ${i.filesLeft === 1 ? "is" : "are"} waiting` : "Not open",
			note: waiting && !agent.teaching ? "Open it and it starts reading" : agent.teaching ? `${i.teacher} does the reading between your messages` : "Reads your files so the teacher stays free",
			open: "Open helper",
		};
	}
	if (agent.helperCovering) return { tone: "busy", chip: "Covering", line: `Answering for ${i.teacher} for a minute`, note: `${i.teacher} is tidying its memory`, open: null };
	if (i.background) {
		const reading = i.background.text.startsWith("Reading ");
		return { tone: "busy", chip: reading ? "Reading" : "Working", line: i.background.count ? `${i.background.text}, ${i.background.count}` : i.background.text, note: i.files ?? "Does the background work", open: null };
	}
	return { tone: "on", chip: "Open", line: "Nothing to do right now", note: "It starts by itself when you add files", open: null };
}
