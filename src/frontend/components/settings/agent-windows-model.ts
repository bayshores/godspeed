/**
 * Settings → Connection, "Your agent": the headline and what the Teacher
 * and Helper tiles say. Pure.
 */
import type { SpaceSummary } from "@/shared/core";
import { teachStep, type AgentStatus } from "@/frontend/components/agent-status";
import type { AgentDoing } from "@/frontend/components/teacher/follow-status";
import { files, filesProgress } from "@/frontend/components/work/work-model";

export interface AgentTile {
	/** on: running. busy: working (striped edge). off: not running. */
	tone: "on" | "busy" | "off";
	chip: string;
	line: string;
	note: string;
	/** The tile's button, when it has one. */
	start: string | null;
}

type Agent = Pick<AgentStatus, "connected" | "teaching" | "name" | "helperHere" | "helperCovering" | "pendingTurns">;

/** godspeed's own terminal for that role: it runs and has not checked in
 *  yet, it ended, or there is none to speak of. */
export type TermState = "starting" | "ended" | null;

/** The teacher runs: it teaches, or it connected and has not started. */
const teacherRuns = (agent: Agent) => agent.teaching || (agent.connected && !agent.helperHere);

/** `name`: the teacher's name. `starting`: godspeed's terminal for it runs and has not checked in. */
export function agentHeadline(agent: Agent, name: string, starting: boolean): string {
	if (teacherRuns(agent)) return `${name} is running`;
	if (starting) return `${name} is starting`;
	return agent.helperHere ? "The helper is running" : "No agent is running";
}

/** `outside`: the agent here was started outside godspeed. */
export function teacherTile(agent: Agent, doing: AgentDoing | null, i: { outside: boolean; term: TermState }): AgentTile {
	const note = i.outside ? "Connected from outside godspeed." : "Teaches and answers you";
	if (agent.helperCovering) return { tone: "on", chip: "Teaching", line: "Tidying its memory", note: "The helper answers for a minute", start: null };
	if (agent.teaching) return { tone: "on", chip: "Teaching", line: doing?.working ? doing.text : "Nothing to do right now", note, start: null };
	if (teacherRuns(agent)) return { tone: "on", chip: "Running", line: teachStep(agent.name), note, start: null };
	if (i.term === "starting") return { tone: "off", chip: "Starting", line: "", note, start: null };
	return {
		tone: "off",
		chip: i.term === "ended" ? "Stopped" : "Not running",
		line: agent.pendingTurns > 0 ? "Your lesson is waiting" : "",
		note: "Start it and it teaches you",
		start: "Start teacher",
	};
}

/** "6 of 17 files in Machine Learning", over every space being read; null when none is. */
export function filesLine(spaces: readonly Pick<SpaceSummary, "name" | "filesLeft" | "filesRead" | "closed">[]): string | null {
	const { live, read, left } = filesProgress(spaces);
	if (live.length === 0) return null;
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
	/** godspeed's terminal for the helper; "ended" only while the teacher's still runs. */
	term: TermState;
	/** godspeed starts the helper by itself when background jobs wait
	 *  (the desktop app, the teacher not started outside it). */
	autoStart: boolean;
}): AgentTile {
	const { agent } = i;
	if (!agent.helperHere) {
		const note = "Reads your files so the teacher stays free";
		if (i.term === "starting") return { tone: "off", chip: "Starting", line: "", note, start: null };
		if (i.term === "ended") return { tone: "off", chip: "Stopped", line: "", note, start: "Start again" };
		const waiting = i.filesLeft > 0;
		const line = waiting ? `${files(i.filesLeft)} ${i.filesLeft === 1 ? "is" : "are"} waiting` : "";
		if (i.autoStart) return { tone: "off", chip: "Not running", line, note: "Starts by itself when there is reading to do", start: null };
		return {
			tone: "off",
			chip: "Not running",
			line,
			note: waiting && !agent.teaching ? "Start it and it reads them" : agent.teaching ? `${i.teacher} does the reading between your messages` : note,
			start: "Start helper",
		};
	}
	if (agent.helperCovering) return { tone: "busy", chip: "Covering", line: `Answering for ${i.teacher} for a minute`, note: `${i.teacher} is tidying its memory`, start: null };
	if (i.background) {
		const reading = i.background.text.startsWith("Reading ");
		return { tone: "busy", chip: reading ? "Reading" : "Working", line: i.background.count ? `${i.background.text}, ${i.background.count}` : i.background.text, note: i.files ?? "Does the background work", start: null };
	}
	return { tone: "on", chip: "Running", line: "Nothing to do right now", note: "It starts by itself when you add files", start: null };
}
