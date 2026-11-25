/**
 * The built-in terminal, in words and rules: when its screen opens by
 * itself, what its footer and the teacher's status line say, which start
 * is allowed, and the columns and rows that fit the screen's box. Pure.
 */
import type { FolderAgent } from "@/shared/core";
import { AGENT_LABEL } from "@/frontend/components/agent-folder/agent-folder-model";
import { LINE_HEIGHT } from "./terminal-theme";

/** A question the shell recognised on the screen. Only trust and enter get a button. */
export type TerminalPrompt = "trust" | "enter" | "menu";

/** Stopped by the learner (or by quitting), or exited by itself with its code. */
/** `code: null` without `stopped`: godspeed could not read the screen and ended it. */
export type TerminalEnded = { stopped: true; code: null } | { stopped: false; code: number | null };

/** The teacher's terminal the shell runs, kept after it ends until the next start. */
export interface TerminalRecord {
	id: string;
	agent: FolderAgent;
	/** Milliseconds since the epoch. */
	startedAt: number;
	ended: TerminalEnded | null;
	prompt: TerminalPrompt | null;
	/** The screen shows a web link. */
	url: boolean;
}

/** The start scripts' own exit codes, and the shell's when the agent said the chat to go back to is gone. */
const EXIT_NOT_INSTALLED = 3;
const EXIT_NO_NODE = 4;
const EXIT_CHAT_GONE = 5;
const EXIT_OLD_AGENT = 6;

/** A chat the teacher had in godspeed's terminal, to go back to (GET /api/teacher-chats). */
export interface TeacherChat {
	id: string;
	agent: FolderAgent;
	/** The first line typed to it. */
	name: string | null;
	/** Last used, ms since the epoch. */
	at: number;
	/** The teacher's terminal runs it now. */
	open: boolean;
}

/** The agent said the chat it was to go back to is gone. */
export const chatGone = (ended: TerminalEnded | null): boolean => ended?.stopped === false && ended.code === EXIT_CHAT_GONE;

/** No check-in this long after a start: the agent may be waiting on its screen. */
export const CHECK_IN_WAIT_MS = 20_000;

/** The size every terminal starts at (the shell opens it so); a shown
 *  screen then takes the size of its box, at one font size. */
export const START_COLS = 80;
export const START_ROWS = 30;
export const FONT_SIZE = 13;
/** The shell keeps a screen inside the same range. */
const MIN_COLS = 40;
const MAX_COLS = 200;
const MIN_ROWS = 10;
const MAX_ROWS = 100;

/** One character's box on the screen, in px. */
export interface Cell {
	width: number;
	height: number;
}
/** A cell before xterm has drawn one to measure, rounded up as xterm
 *  rounds a row's height. */
export const CELL: Cell = { width: 0.62 * FONT_SIZE, height: Math.ceil(1.24 * LINE_HEIGHT * FONT_SIZE) };

/** The columns and rows that fit a box. A box too small for 40 by 10
 *  scrolls inside, never cuts. */
export function gridSize(width: number, height: number, cell: Cell = CELL): { cols: number; rows: number } {
	const within = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Math.floor(n)));
	return { cols: within(width / cell.width, MIN_COLS, MAX_COLS), rows: within(height / cell.height, MIN_ROWS, MAX_ROWS) };
}

/** What the page knows about one terminal at a moment. */
export interface TerminalFacts {
	term: TerminalRecord;
	/** A request from it has reached godspeed at least once: a long wait or
	 *  turn after that is no reason to think it is still starting. */
	checkedIn: boolean;
	/** An agent outside godspeed's terminals is here. */
	outsideHere: boolean;
	now: number;
}

/** Why the screen opens by itself. */
type NeedsYou = "prompt" | "no-check-in" | "crashed" | "missing";

const crashed = (ended: TerminalEnded | null) => ended?.stopped === false && ended.code !== 0;
const missing = (ended: TerminalEnded | null) => ended?.stopped === false && (ended.code === EXIT_NOT_INSTALLED || ended.code === EXIT_NO_NODE || ended.code === EXIT_OLD_AGENT);

/** Why the learner is needed at this terminal's screen, or null. A
 *  learner's own Stop needs nothing. */
export function needsYou(f: TerminalFacts): NeedsYou | null {
	const { term } = f;
	if (term.ended) return missing(term.ended) ? "missing" : crashed(term.ended) ? "crashed" : null;
	if (term.prompt) return "prompt";
	return !f.checkedIn && f.now - term.startedAt >= CHECK_IN_WAIT_MS ? "no-check-in" : null;
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
 *  says the teacher starts instead. Only installing and signing in name
 *  the program; the rest say `name`. */
interface ScreenWords {
	need: string | null;
	rest: string | null;
	more?: Partial<TerminalFooter>;
	starting?: boolean;
}

function screenWords(f: TerminalFacts, name: string): ScreenWords {
	const { term } = f;
	const agent = AGENT_LABEL[term.agent];
	const ended = term.ended;
	const again = { startAgain: true };
	if (ended?.stopped) return { need: null, rest: `You stopped ${name}.`, more: again };
	if (ended) {
		if (ended.code === EXIT_NOT_INSTALLED) return { need: `${agent} isn't installed on this computer.`, rest: null, more: { get: GET_AGENT[term.agent], ...again } };
		if (ended.code === EXIT_NO_NODE) return { need: `godspeed needs Node.js to connect ${agent}.`, rest: null, more: { get: GET_NODE, ...again } };
		// The screen above says how to update.
		if (ended.code === EXIT_OLD_AGENT) return { need: `${agent} needs an update.`, rest: null, more: again };
		if (ended.code === EXIT_CHAT_GONE) return { need: "Couldn't open that chat.", rest: null, more: again };
		if (ended.code === 0) return { need: null, rest: `${name} closed.`, more: again };
		return { need: `${name} closed with an error.`, rest: null, more: again };
	}
	if (term.prompt === "trust")
		return { need: `${name} asks to trust its folder.`, rest: null, more: { assist: { kind: "trust", label: "Trust folder" } } };
	if (term.prompt === "enter") return { need: `${name} is asking you to continue.`, rest: null, more: { assist: { kind: "enter", label: "Continue" } } };
	// Only a link says signing in: a menu before the first check-in may be any question (Codex asks about new hooks).
	if (!f.checkedIn && term.url)
		return { need: `Finish signing in to ${agent}.`, rest: "Got a code? Click Paste." };
	if (term.prompt === "menu") return { need: `${name} is asking you something.`, rest: null };
	if (needsYou(f) === "no-check-in") return { need: `${name} hasn't connected to godspeed yet.`, rest: null };
	if (!f.checkedIn) return { need: `${name} is starting.`, rest: null, starting: true };
	return { need: null, rest: null };
}

/** The footer under a screen. `underStatus`: the screen's status line
 *  shows above it (the teacher's panel), so the footer leaves out what that
 *  line already says. */
export function terminalFooter(f: TerminalFacts, name: string, underStatus: boolean): TerminalFooter {
	const w = screenWords(f, name);
	const state = underStatus ? teacherTerminalState(f) : null;
	const said = state !== null && state === (w.starting ? "starting" : "needsYou");
	const text = said ? w.rest : [w.need, w.rest].filter(Boolean).join(" ") || null;
	return footer(text, w.more);
}

/** What the teacher's terminal adds to its status (the status lines and
 *  the strip): it starts, or it needs the learner. */
export type TeacherTerminalState = "starting" | "needsYou";

export function teacherTerminalState(f: TerminalFacts | null): TeacherTerminalState | null {
	// An agent outside godspeed teaches: an old record says nothing.
	if (!f || f.term.ended?.stopped || f.outsideHere) return null;
	if (needsYou(f)) return "needsYou";
	if (!f.term.ended && !f.checkedIn) return "starting";
	return null;
}

/** A screen's status line while its terminal starts or needs the learner
 *  (what it needs); null leaves the usual line. `name` names whose screen. */
export function screenStatusLine(f: TerminalFacts | null, name: string): string | null {
	const state = teacherTerminalState(f);
	if (state === "needsYou") return screenWords(f!, name).need ?? `${name} needs you.`;
	if (state === "starting") return `${name} is starting.`;
	return null;
}

const live = (term: TerminalRecord | null): boolean => !!term && !term.ended;

/** The largest file Attach takes, as the shell says too: a bigger one is not even read. */
export const ATTACH_MAX_BYTES = 20 * 1024 * 1024;
export const ATTACH_TOO_BIG = "That file is over 20 MB.";

/** Why the teacher doesn't start while an agent outside godspeed is here. */
export const OUTSIDE_REFUSAL = "The teacher is already running outside godspeed. Close it there first.";

/** Why a teacher start is refused: its terminal runs, or an agent outside
 *  godspeed is here. Null when it may start. */
export function teacherStartRefused(teacher: TerminalRecord | null, outsideHere: boolean): "running" | "outside" | null {
	if (live(teacher)) return "running";
	return outsideHere ? "outside" : null;
}

/** The server counts an agent here for 3 minutes after its last request,
 *  so after godspeed's teacher ended, or before a new one checked in, it
 *  still says so. The terminals know: once godspeed has started a teacher,
 *  no agent here means none connected, and its own teacher, running and
 *  checked in, is connected. Whether an agent is picked (`teaching`) is
 *  the server's alone. */
export function statusFromTerminals<S extends { connected: boolean; name?: string }>(status: S | null, teacher: TerminalRecord | null, agentHere: boolean): S | null {
	if (status && agentHere && live(teacher) && !status.connected) return { ...status, connected: true };
	if (!status || !teacher || agentHere || !status.connected) return status;
	const { name: _gone, ...rest } = status;
	return { ...rest, connected: false } as S;
}

