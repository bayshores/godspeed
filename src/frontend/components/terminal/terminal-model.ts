/**
 * The built-in terminal, in words and rules: when its screen opens by
 * itself, what its footer and the teacher's status line say, which start
 * is allowed, and the columns and rows that fit the screen's box. Pure.
 */
import type { FolderAgent } from "@/shared/core";
import { AGENT_LABEL } from "@/frontend/components/agent-folder/agent-folder-model";
import { LINE_HEIGHT } from "./terminal-theme";

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

/** The start scripts' own exit codes, and the shell's when the agent said the chat to go back to is gone. */
const EXIT_NOT_INSTALLED = 3;
const EXIT_NO_NODE = 4;
const EXIT_CHAT_GONE = 5;

/** A chat the teacher had in godspeed's terminal, to go back to (GET /api/teacher-chats). */
export interface TeacherChat {
	id: string;
	agent: FolderAgent;
	/** The last lesson it taught, else the first line typed to it. */
	name: string | null;
	/** Last used, ms since the epoch. */
	at: number;
}

/** The agent said the chat it was to go back to is gone. */
export const chatGone = (ended: TerminalEnded | null): boolean => ended?.stopped === false && ended.code === EXIT_CHAT_GONE;

/** No check-in this long after a start: the agent may be waiting on its screen. */
export const CHECK_IN_WAIT_MS = 20_000;
/** Checked in, a turn waits, and no teaching for this long (godspeed nudges a quiet teacher for a minute first). */
export const TEACH_WAIT_MS = 75_000;

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
	if (ended?.stopped) return { need: null, rest: teacher ? `You stopped ${name}.` : "Stopped.", more: again };
	if (ended) {
		if (ended.code === EXIT_NOT_INSTALLED) return { need: `${agent} isn't installed on this computer.`, rest: null, more: { get: GET_AGENT[term.agent], ...again } };
		if (ended.code === EXIT_NO_NODE) return { need: `godspeed needs Node.js to connect ${agent}.`, rest: null, more: { get: GET_NODE, ...again } };
		if (ended.code === EXIT_CHAT_GONE) return { need: "Couldn't open that chat.", rest: null, more: again };
		if (ended.code === 0) return { need: null, rest: `${agent} closed.`, more: again };
		return { need: `${agent} closed with an error.`, rest: null, more: again };
	}
	if (term.prompt === "trust")
		return { need: `${agent} asks to trust its folder.`, rest: null, more: { assist: { kind: "trust", label: "Trust folder" } } };
	if (term.prompt === "enter") return { need: `${agent} is asking you to continue.`, rest: null, more: { assist: { kind: "enter", label: "Continue" } } };
	if (!f.checkedIn && (term.url || term.prompt === "menu"))
		return { need: `Finish signing in to ${agent}.`, rest: "Got a code? Click Paste." };
	if (term.prompt === "menu") return { need: `${agent} is asking you something.`, rest: null };
	const why = needsYou(f);
	if (why === "no-check-in" || why === "not-teaching") return { need: `${name} hasn't started teaching yet.`, rest: null };
	if (!f.checkedIn) return { need: `${agent} is starting.`, rest: null, starting: true };
	if (teacher) return { need: null, rest: null };
	return { need: null, rest: f.helperBusy ? "Reading your files." : "Waiting for files." };
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
 *  the top bar pill): it starts, or it needs the learner. */
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
export const OUTSIDE_REFUSAL = "An agent outside godspeed is connected. Close it first.";

/** Why a teacher start is refused: its terminal runs, or an agent outside
 *  godspeed is here. Null when it may start. */
export function teacherStartRefused(teacher: TerminalRecord | null, outsideHere: boolean): "running" | "outside" | null {
	if (live(teacher)) return "running";
	return outsideHere ? "outside" : null;
}

/** The helper starts by itself, once per teacher run: the teacher's
 *  terminal runs and checked in, background jobs wait that the teacher
 *  leaves to a helper (`helperWork`), no helper is here, and none was
 *  started since this teacher started. */
export function helperShouldStart(i: {
	teacher: TerminalRecord | null;
	teacherCheckedIn: boolean;
	helper: TerminalRecord | null;
	helperHere: boolean;
	helperWork: number;
}): boolean {
	const { teacher, helper } = i;
	if (!teacher || teacher.ended || !i.teacherCheckedIn || i.helperWork <= 0 || i.helperHere) return false;
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
 *  helping (the shell stops the helper with the teacher). And its own
 *  teacher, running and checked in, is ready to teach even while it sits
 *  quiet: godspeed wakes it when a lesson needs it. */
export function statusFromTerminals<S extends { connected: boolean; teaching: boolean; helperHere: boolean; helperCovering: boolean; name?: string }>(
	status: S | null,
	teacher: TerminalRecord | null,
	agentHere: boolean,
): S | null {
	if (status && agentHere && live(teacher) && !(status.connected && status.teaching)) return { ...status, connected: true, teaching: true };
	if (!status || !teacher || agentHere || !(status.connected || status.teaching || status.helperHere || status.helperCovering)) return status;
	const { name: _gone, ...rest } = status;
	return { ...rest, connected: false, teaching: false, helperHere: false, helperCovering: false } as S;
}

/** Restart now asks first while the teacher's terminal runs and a lesson
 *  turn waits for it. */
export function restartAsks(teacher: TerminalRecord | null, pendingTurns: number): boolean {
	return live(teacher) && pendingTurns > 0;
}
