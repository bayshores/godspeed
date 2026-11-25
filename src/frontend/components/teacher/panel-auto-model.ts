/**
 * When the teacher's panel opens and closes by itself (use-teacher-panel.ts).
 * It opens when a need for the learner arises (a card in its chat waits to be
 * allowed), once the learner has paused typing, and closes when that need is
 * settled or when a lesson reply starts. While the chat is in its own window it
 * never opens: the strip lights. It also opens once for a new learner, the first
 * time Home shows with the teacher on, so they see what the teacher can be asked.
 */
/** Set when onboarding ends, removed once the panel has opened for it. */
export const WELCOME_KEY = "lh:teacher-welcome";

/** The new learner's first look is now: onboarding left its mark, Home shows and the teacher runs. */
export function welcomeNow(w: { marked: boolean; onHome: boolean; teacherOn: boolean }): boolean {
	return w.marked && w.onHome && w.teacherOn;
}

/** How long after the last key in a writing box the panel keeps waiting. */
export const TYPING_PAUSE_MS = 3000;

/** What the last step saw, kept between steps. */
export interface PanelMemory {
	/** A card in the panel's chat waited to be allowed. */
	need: boolean;
	/** A lesson reply is running; null while no lesson is open. */
	replying: boolean | null;
	/** A need arose and the panel has not opened for it yet. */
	waiting: boolean;
}

export const FIRST_LOOK: PanelMemory = { need: false, replying: null, waiting: false };

export interface PanelNow {
	need: boolean;
	replying: boolean | null;
}

export interface PanelSeen {
	open: boolean;
	/** The panel opened by itself and the learner has not taken it over. */
	byApp: boolean;
	/** The panel's chat is in its own window. */
	popped: boolean;
}

export type PanelAct = "open" | "close" | null;

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
	const arrived = !mem.need && now.need;
	const settled = mem.need && !now.need;
	const replyStarted = mem.replying === false && now.replying === true;

	// A need that arrives while popped is not held for later: put back, the panel stays as it is.
	const waiting = (mem.waiting || arrived) && now.need && !pane.open && !pane.popped;
	const opens = waiting && waitLeft === 0;
	const closes = pane.open && ((settled && pane.byApp) || (replyStarted && !now.need));

	const next: PanelMemory = { need: now.need, replying: now.replying, waiting: waiting && !opens };
	return { mem: next, act: opens ? "open" : closes ? "close" : null };
}
