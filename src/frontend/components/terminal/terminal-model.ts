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
const MIN_FONT = 8;
const MAX_FONT = 14;
/** A monospace cell, in ems, rounded up so the last column and row fit. */
const CELL_WIDTH = 0.62;
const CELL_HEIGHT = 1.2;

/** The screen's width at a font size, and at the largest (the room the panel makes for it). */
export const screenWidth = (font: number): number => Math.ceil(COLS * CELL_WIDTH * font);
export const FULL_SCREEN_WIDTH = screenWidth(MAX_FONT);

/** The largest font from 8 to 14 px whose whole 100 by 30 screen fits the
 *  box. A box too small even at 8 px scrolls inside, never cuts. */
export function fitFontSize(width: number, height: number): number {
	const fit = Math.floor(Math.min(width / (COLS * CELL_WIDTH), height / (ROWS * CELL_HEIGHT)));
	return Math.max(MIN_FONT, Math.min(MAX_FONT, fit));
}

/** What the page knows about one terminal at a moment. */
export interface TerminalFacts {
	term: TerminalRecord;
	/** A request from it has reached godspeed at least once: a long wait or
	 *  turn after that is no reason to think it is still starting. */
	checkedIn: boolean;
	/** An agent outside godspeed's terminals is here. */
	outsideHere: boolean;
	/** The teacher runs its work loop. */
	teaching: boolean;
	now: number;
	/** Since when it has been here, not teaching, while a lesson turn waits; else null. */
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
	if (!f.checkedIn) return f.now - term.startedAt >= CHECK_IN_WAIT_MS ? "no-check-in" : null;
	if (f.teaching) return null;
	return f.quietSince !== null && f.now - f.quietSince >= TEACH_WAIT_MS ? "not-teaching" : null;
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

/** The footer under the screen: a sentence (or none), an assist key, a
 *  page to get something, and whether Start again shows. The assist key,
 *  else Start again, is the bright one. */
export interface TerminalFooter {
	text: string | null;
	assist: { kind: "trust" | "enter"; label: string } | null;
	get: GetLink | null;
	startAgain: boolean;
}

const footer = (text: string | null, more: Partial<TerminalFooter> = {}): TerminalFooter => ({ text, assist: null, get: null, startAgain: false, ...more });

/** What a screen says: `need` is the short form the teacher's status line
 *  shows, `rest` what only the footer adds. `starting`: the status line
 *  says the teacher starts instead. */
interface ScreenWords {
	need: string | null;
	rest: string | null;
	more?: Partial<TerminalFooter>;
	starting?: boolean;
}

function screenWords(f: TerminalFacts, name: string): ScreenWords {
	const { term } = f;
	const agent = AGENT_LABEL[term.agent];
	const teacher = term.role === "teacher";
	const ended = term.ended;
	const again = { startAgain: true };
	// The shell also stops the helper when the teacher ends.
	if (ended?.stopped) return { need: null, rest: teacher ? `You stopped ${name}.` : "The helper stopped.", more: again };
	if (ended) {
		if (ended.code === EXIT_NOT_INSTALLED) return { need: `${agent} isn't installed on this computer.`, rest: null, more: { get: GET_AGENT[term.agent], ...again } };
		if (ended.code === EXIT_NO_NODE) return { need: `godspeed needs Node.js to connect ${agent}.`, rest: null, more: { get: GET_NODE, ...again } };
		if (ended.code === 0) return { need: null, rest: `${agent} closed.`, more: again };
		return { need: `${agent} closed with an error.`, rest: "The last lines are above.", more: again };
	}
	if (term.prompt === "trust")
		return { need: `${agent} asks to trust its folder.`, rest: "godspeed made the folder for it.", more: { assist: { kind: "trust", label: "Yes, trust this folder" } } };
	if (term.prompt === "enter") return { need: `${agent} is asking you to continue.`, rest: null, more: { assist: { kind: "enter", label: "Continue" } } };
	if (!f.checkedIn && (term.url || term.prompt === "menu"))
		return { need: `Finish signing in to ${agent}.`, rest: "If your browser gives you a code, copy it and click Paste." };
	if (term.prompt === "menu") return { need: `${agent} is asking you something.`, rest: "Answer it on the screen." };
	const why = needsYou(f);
	if (why === "no-check-in" || why === "not-teaching") return { need: `${name} hasn't started teaching yet.`, rest: "Check the screen for a question." };
	if (!f.checkedIn) return { need: `${agent} is starting.`, rest: `If ${agent} asks you something, answer it here.`, starting: true };
	if (teacher) return { need: null, rest: null };
	return { need: null, rest: f.helperBusy ? "The helper is reading your files." : "The helper is waiting for files to read." };
}

/** The footer under a screen. `underStatus`: the teacher's status line
 *  shows above it (the teacher's panel), so the teacher's footer leaves out
 *  what that line already says. */
export function terminalFooter(f: TerminalFacts, name: string, underStatus: boolean): TerminalFooter {
	const w = screenWords(f, name);
	const state = underStatus && f.term.role === "teacher" ? teacherTerminalState(f) : null;
	const said = state !== null && state === (w.starting ? "starting" : "needsYou");
	const text = said ? w.rest : [w.need, w.rest].filter(Boolean).join(" ") || null;
	return footer(text, w.more);
}

/** What the teacher's terminal adds to its status (the status lines and
 *  the top bar chip): it starts, or it needs the learner. */
export type TeacherTerminalState = "starting" | "needsYou";

export function teacherTerminalState(f: TerminalFacts | null): TeacherTerminalState | null {
	// An agent outside godspeed teaches: an old record says nothing.
	if (!f || f.term.ended?.stopped || f.outsideHere) return null;
	if (needsYou(f)) return "needsYou";
	if (!f.term.ended && !f.checkedIn) return "starting";
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
 *  learner (what it needs); null leaves the usual line. */
export function teacherStatusLine(f: TerminalFacts | null, name: string): string | null {
	const state = teacherTerminalState(f);
	if (state === "needsYou") return screenWords(f!, name).need ?? teacherStateWords(state, name, "line");
	return teacherStateWords(state, name, "line");
}

const live = (term: TerminalRecord | null): boolean => !!term && !term.ended;

/** Why the teacher doesn't start while an agent outside godspeed is here. */
/** The largest file Attach takes, as the shell says too: a bigger one is not even read. */
export const ATTACH_MAX_BYTES = 20 * 1024 * 1024;
export const ATTACH_TOO_BIG = "That file is over 20 MB.";

export const OUTSIDE_REFUSAL = "An agent started outside godspeed is already connected. Close it there, then start one here.";

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
	teacherCheckedIn: boolean;
	helper: TerminalRecord | null;
	helperHere: boolean;
	backgroundWaiting: number;
}): boolean {
	const { teacher, helper } = i;
	if (!teacher || teacher.ended || !i.teacherCheckedIn || i.backgroundWaiting <= 0 || i.helperHere) return false;
	return !helper || (!!helper.ended && helper.startedAt < teacher.startedAt);
}

/** Onboarding's footer under the screen: the panel's words while the
 *  agent asks something or has ended, else whether it has connected. */
export function firstRunFooter(f: TerminalFacts, folder: string): TerminalFooter {
	const { term } = f;
	const agent = AGENT_LABEL[term.agent];
	if (term.ended || term.prompt || (!f.checkedIn && term.url)) return terminalFooter(f, agent, false);
	return footer(f.checkedIn ? `${agent} is connected.` : `${agent} is starting in ${folder}. If it asks you something, answer it here.`);
}

/** Start lesson and a lesson's send start the teacher hidden, with the agent
 *  last started in godspeed, when no agent is here and none runs or
 *  starts. Null leaves it to the no-agent line. */
export function wakeAgent(i: { teacher: TerminalRecord | null; agentHere: boolean; outsideHere: boolean; saved: string | null }): FolderAgent | null {
	if (i.agentHere || teacherStartRefused(i.teacher, i.outsideHere)) return null;
	// A crash or a missing program waits for the learner's Start again.
	if (crashed(i.teacher?.ended ?? null)) return null;
	return i.saved === "claude" || i.saved === "codex" ? i.saved : null;
}

/** The server counts an agent (and the helper) here for 3 minutes after
 *  its last request, so after godspeed's teacher ended, or before a new one
 *  checked in, it still says so. The terminals know: once godspeed has
 *  started a teacher, no agent here means none connected, teaching or
 *  helping (the shell stops the helper with the teacher). */
export function statusFromTerminals<S extends { connected: boolean; teaching: boolean; helperHere: boolean; helperCovering: boolean; name?: string }>(
	status: S | null,
	teacher: TerminalRecord | null,
	agentHere: boolean,
): S | null {
	if (!status || !teacher || agentHere || !(status.connected || status.teaching || status.helperHere || status.helperCovering)) return status;
	const { name: _gone, ...rest } = status;
	return { ...rest, connected: false, teaching: false, helperHere: false, helperCovering: false } as S;
}

/** Restart now asks first while the teacher's terminal runs and a lesson
 *  turn waits for it. */
export function restartAsks(teacher: TerminalRecord | null, pendingTurns: number): boolean {
	return live(teacher) && pendingTurns > 0;
}
