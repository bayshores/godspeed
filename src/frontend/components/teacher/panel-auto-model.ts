/**
 * When the teacher's panel opens and closes by itself (use-teacher-panel.ts).
 * It opens when a need for the learner arises, once the learner has paused
 * typing, and closes when that need is settled or when a lesson reply starts.
 */
import type { TerminalRole } from "@/frontend/components/terminal/terminal-model";

/** How long after the last key in a writing box the panel keeps waiting. */
export const TYPING_PAUSE_MS = 3000;

/** What the last step saw, kept between steps. */
export interface PanelMemory {
	/** The terminal that needed the learner, if any. */
	need: TerminalRole | null;
	/** A lesson reply is running; null while no lesson is open. */
	replying: boolean | null;
	/** A need arose and the panel has not opened for it yet. */
	waiting: boolean;
}

export const FIRST_LOOK: PanelMemory = { need: null, replying: null, waiting: false };

export interface PanelNow {
	need: TerminalRole | null;
	replying: boolean | null;
}

export interface PanelSeen {
	open: boolean;
	/** The panel opened by itself and the learner has not taken it over. */
	byApp: boolean;
}

export type PanelAct = { open: TerminalRole } | "close" | null;

/** Milliseconds left before the learner has paused long enough; 0 when they have. */
export function typingWaitLeft(lastKeyAt: number | null, now: number): number {
	return lastKeyAt === null ? 0 : Math.max(0, lastKeyAt + TYPING_PAUSE_MS - now);
}

/** A keyboard target the learner writes in: a text box, a text field or an editable element. */
export function isWritingBox(target: { tag: string; inputType: string; editable: boolean; inTerminal: boolean }): boolean {
	if (target.inTerminal) return false;
	if (target.editable || target.tag === "TEXTAREA") return true;
	return target.tag === "INPUT" && !NOT_TEXT.has(target.inputType);
}

const NOT_TEXT = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image", "hidden"]);

/**
 * One look at the world: what to do now, and what to remember. Only a change
 * counts: a need already there, or a reply already running, when the panel
 * was closed by the learner does nothing.
 */
export function stepPanel(mem: PanelMemory, now: PanelNow, pane: PanelSeen, waitLeft: number): { mem: PanelMemory; act: PanelAct } {
	const arrived = mem.need === null && now.need !== null;
	const settled = mem.need !== null && now.need === null;
	const replyStarted = mem.replying === false && now.replying === true;

	const waiting = (mem.waiting || arrived) && now.need !== null && !pane.open;
	const opens = waiting && waitLeft === 0;
	const closes = pane.open && ((settled && pane.byApp) || (replyStarted && now.need === null));

	const next: PanelMemory = { need: now.need, replying: now.replying, waiting: waiting && !opens };
	if (opens && now.need) return { mem: next, act: { open: now.need } };
	return { mem: next, act: closes ? "close" : null };
}
