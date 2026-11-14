/**
 * The built-in terminal, in words and rules: when its screen opens by
 * itself, what its footer and the teacher's status line say, which start
 * is allowed, and the font size that fits the fixed screen. Pure.
 */
import type { FolderAgent } from "@/shared/core";
import { AGENT_LABEL } from "@/frontend/components/agent-folder/agent-folder-model";

export type TerminalRole = "teacher" | "helper";

/** A question the shell recognised on the screen. Only trust and enter get a button. */
export type TerminalPrompt = "trust" | "enter" | "menu";

/** Stopped by the learner (or by quitting), or exited by itself with its code. */
/** `code: null` without `stopped`: godspeed could not read the screen and ended it. */
export type TerminalEnded = { stopped: true; code: null } | { stopped: false; code: number | null };

/** One terminal the shell runs, kept after it ends until the next start for its role. */
export interface TerminalRecord {
	id: string;
	role: TerminalRole;
	agent: FolderAgent;
	/** Milliseconds since the epoch. */
	startedAt: number;
	ended: TerminalEnded | null;
	prompt: TerminalPrompt | null;
	/** The screen shows a web link. */
	url: boolean;
}

/** The start scripts' own exit codes. */
const EXIT_NOT_INSTALLED = 3;
const EXIT_NO_NODE = 4;

/** No check-in this long after a start: the agent may be waiting on its screen. */
export const CHECK_IN_WAIT_MS = 20_000;
/** Checked in, a turn waits, and no teaching for this long. */
export const TEACH_WAIT_MS = 30_000;

/** The screen's fixed size; the font scales to fit it. */
export const COLS = 100;
export const ROWS = 30;
const MIN_FONT = 11;
const MAX_FONT = 14;
/** A monospace cell, in ems. */
const CELL_WIDTH = 0.6;
const CELL_HEIGHT = 1.2;

/** The largest font from 11 to 14 px whose 100 by 30 screen fits the box.
 *  Below 11 px it stays at 11 and the screen scrolls sideways. */
export function fitFontSize(width: number, height: number): number {
	const fit = Math.floor(Math.min(width / (COLS * CELL_WIDTH), height / (ROWS * CELL_HEIGHT)));
	return Math.max(MIN_FONT, Math.min(MAX_FONT, fit));
}

/** What the page knows about one terminal at a moment. */
export interface TerminalFacts {
	term: TerminalRecord;
	/** A request from this terminal reached godspeed in the last 3 minutes. */
	here: boolean;
	/** The teacher runs its work loop. */
	teaching: boolean;
	now: number;
	/** Since when it has been here, not teaching, while a lesson or Talk turn waits; else null. */
	quietSince: number | null;
	/** Background jobs are being read. */
	helperBusy: boolean;
}

/** Why the screen opens by itself. */
type NeedsYou = "prompt" | "no-check-in" | "not-teaching" | "crashed" | "missing";

const crashed = (ended: TerminalEnded | null) => ended?.stopped === false && ended.code !== 0;
const missing = (ended: TerminalEnded | null) => ended?.stopped === false && (ended.code === EXIT_NOT_INSTALLED || ended.code === EXIT_NO_NODE);

/** Why the learner is needed at this terminal's screen, or null. The
 *  timers only count for the teacher; a learner's own Stop needs nothing. */
export function needsYou(f: TerminalFacts): NeedsYou | null {
	const { term } = f;
	if (term.ended) return missing(term.ended) ? "missing" : crashed(term.ended) ? "crashed" : null;
	if (term.prompt) return "prompt";
	if (term.role !== "teacher") return null;
	if (!f.here) return f.now - term.startedAt >= CHECK_IN_WAIT_MS ? "no-check-in" : null;
	if (!f.teaching && f.quietSince !== null && f.now - f.quietSince >= TEACH_WAIT_MS) return "not-teaching";
	return null;
}

/** The names in the words: the teacher's stored name and the short folder. */
interface TerminalNames {
	name: string;
	folder: string;
}

/** A page to get what is missing. */
export interface GetLink {
	label: string;
	url: string;
}

const GET_AGENT: Record<FolderAgent, GetLink> = {
	claude: { label: "Get Claude Code", url: "https://claude.com/claude-code" },
	codex: { label: "Get Codex", url: "https://developers.openai.com/codex" },
};
const GET_NODE: GetLink = { label: "Get Node.js", url: "https://nodejs.org" };

/** The overlay's footer: one sentence, an assist key, a page to get
 *  something, and whether Start again shows. The assist key, else Start
 *  again, is the bright one. */
export interface TerminalFooter {
	text: string;
	assist: { kind: "trust" | "enter"; label: string } | null;
	get: GetLink | null;
	startAgain: boolean;
}

const footer = (text: string, more: Partial<TerminalFooter> = {}): TerminalFooter => ({ text, assist: null, get: null, startAgain: false, ...more });

export function terminalFooter(f: TerminalFacts, names: TerminalNames): TerminalFooter {
	const { term } = f;
	const agent = AGENT_LABEL[term.agent];
	const teacher = term.role === "teacher";
	const ended = term.ended;
	// The shell also stops the helper when the teacher ends.
	if (ended?.stopped) return footer(teacher ? `You stopped ${names.name}.` : "The helper stopped.", { startAgain: true });
	if (ended) {
		if (ended.code === EXIT_NOT_INSTALLED) return footer(`${agent} isn't installed on this computer.`, { get: GET_AGENT[term.agent], startAgain: true });
		if (ended.code === EXIT_NO_NODE) return footer(`godspeed needs Node.js to connect ${agent}.`, { get: GET_NODE, startAgain: true });
		if (ended.code === 0) return footer(`${agent} closed.`, { startAgain: true });
		return footer(`${agent} closed with an error. The last lines are above.`, { startAgain: true });
	}
	if (term.prompt === "trust")
		return footer(`${agent} asks whether it may work in ${names.folder}. godspeed made this folder for it.`, { assist: { kind: "trust", label: "Yes, trust this folder" } });
	if (term.prompt === "enter") return footer(`${agent} is asking you to continue.`, { assist: { kind: "enter", label: "Continue" } });
	if (!f.here && (term.url || term.prompt === "menu")) return footer(`Finish signing in to ${agent} in your browser. If it gives you a code, copy it and click Paste.`);
	if (term.prompt === "menu") return footer(`${agent} is asking you something. Answer it on the screen.`);
	const why = needsYou(f);
	if (why === "no-check-in" || why === "not-teaching") return footer(`${names.name} hasn't started teaching yet. It may be waiting for you on the screen.`);
	if (!f.here) return footer(startingLine(term.agent, names.folder));
	if (teacher) return footer(`${names.name} is running in ${names.folder}.`);
	return footer(f.helperBusy ? "The helper is reading your files." : "The helper is waiting for files to read.");
}

/** While an agent starts and has not checked in (the overlay and onboarding). */
function startingLine(agent: FolderAgent, folder: string): string {
	return `${AGENT_LABEL[agent]} is starting in ${folder}. If it asks you something, answer it here.`;
}

/** What the teacher's terminal adds to its status (the status lines and
 *  the top bar chip): it starts, or it needs the learner. */
export type TeacherTerminalState = "starting" | "needsYou";

export function teacherTerminalState(f: TerminalFacts | null): TeacherTerminalState | null {
	if (!f || f.term.ended?.stopped) return null;
	if (needsYou(f)) return "needsYou";
	if (!f.term.ended && !f.here) return "starting";
	return null;
}

/** That state in words: the status line under the teacher's name, or
 *  the top bar chip's short form. */
export function teacherStateWords(state: TeacherTerminalState | null, name: string, form: "line" | "chip"): string | null {
	if (state === "needsYou") return `${name} needs you.`;
	if (state === "starting") return form === "chip" ? `${name}, starting` : `${name} is starting.`;
	return null;
}

/** The teacher's status line while its terminal starts or needs the
 *  learner; null leaves the usual line. */
export function teacherStatusLine(f: TerminalFacts | null, name: string): string | null {
	return teacherStateWords(teacherTerminalState(f), name, "line");
}

const live = (term: TerminalRecord | null): boolean => !!term && !term.ended;

/** Why a teacher start is refused: its terminal runs, or an agent outside
 *  godspeed is here. Null when it may start. */
export function teacherStartRefused(teacher: TerminalRecord | null, outsideHere: boolean): "running" | "outside" | null {
	if (live(teacher)) return "running";
	return outsideHere ? "outside" : null;
}

/** The helper starts by itself, once per teacher run: the teacher's
 *  terminal runs and checked in, background jobs wait, no helper is here,
 *  and none was started since this teacher started. */
export function helperShouldStart(i: {
	teacher: TerminalRecord | null;
	teacherHere: boolean;
	helper: TerminalRecord | null;
	helperHere: boolean;
	backgroundWaiting: number;
}): boolean {
	const { teacher, helper } = i;
	if (!teacher || teacher.ended || !i.teacherHere || i.backgroundWaiting <= 0 || i.helperHere) return false;
	return !helper || (!!helper.ended && helper.startedAt < teacher.startedAt);
}

/** Onboarding's footer under the screen: the overlay's words while the
 *  agent asks something or has ended, else whether it has connected. */
export function firstRunFooter(f: TerminalFacts, folder: string): TerminalFooter {
	const { term } = f;
	if (term.ended || term.prompt || (!f.here && term.url)) return terminalFooter(f, { name: AGENT_LABEL[term.agent], folder });
	return footer(f.here ? `${AGENT_LABEL[term.agent]} is connected.` : startingLine(term.agent, folder));
}

/** Start lesson and a Talk send start the teacher hidden, with the agent
 *  last started in godspeed, when no agent is here and none runs or
 *  starts. Null leaves it to the no-agent line. */
export function wakeAgent(i: { teacher: TerminalRecord | null; agentHere: boolean; outsideHere: boolean; saved: string | null }): FolderAgent | null {
	if (i.agentHere || teacherStartRefused(i.teacher, i.outsideHere)) return null;
	return i.saved === "claude" || i.saved === "codex" ? i.saved : null;
}

/** Restart now asks first while the teacher's terminal runs and a lesson
 *  or Talk turn waits for it. */
export function restartAsks(teacher: TerminalRecord | null, pendingTurns: number): boolean {
	return live(teacher) && pendingTurns > 0;
}
