/**
 * The teacher's panel state: open or not, whether the Activity list hangs
 * from its status chip, and which screen it shows. The teacher's screen is
 * the panel's own; background work's screen shows only while it needs the
 * learner (or Settings opens it), and the panel goes back to the teacher's
 * once that need is answered. The panel opens by itself when an agent's
 * terminal needs the learner and closes when that is settled or a lesson
 * reply starts (panel-auto-model.ts); opened that way it leaves the keyboard
 * where it is. Only a screen the learner opened takes the keyboard.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { needsYou, type TerminalRole } from "@/frontend/components/terminal/terminal-model";
import { useTerminals } from "@/frontend/components/terminal/use-terminals";
import { FIRST_LOOK, isWritingBox, stepPanel, typingWaitLeft } from "./panel-auto-model";

interface PanelState {
	open: boolean;
	/** The Activity list hangs from the status chip. */
	list: boolean;
	/** The screen the panel shows. */
	role: TerminalRole;
	/** The learner opened that screen: it takes the keyboard. */
	focus: boolean;
	/** The panel opened by itself and the learner has not taken it over. */
	byApp: boolean;
}

const CLOSED: PanelState = { open: false, list: false, role: "teacher", focus: false, byApp: false };

/** `replying`: a reply is running in the open lesson, null with no lesson open. */
export function useTeacherPanel(replying: boolean | null) {
	const [state, setState] = useState<PanelState>(CLOSED);
	const setOpen = useCallback((open: boolean) => setState(open ? { ...CLOSED, open } : CLOSED), []);
	const showTerminal = useCallback((role: TerminalRole = "teacher") => setState({ open: true, list: false, role, focus: true, byApp: false }), []);
	const setList = useCallback((list: boolean) => setState((s) => ({ ...s, list })), []);

	const terminals = useTerminals();
	// Background work's need answered: back to the teacher's screen, which
	// the learner did not open, so it leaves the keyboard where it is.
	const helper = terminals?.facts.helper ?? null;
	const helperNeeds = !!helper && !!needsYou(helper);
	const needed = useRef(helperNeeds);
	useEffect(() => {
		const answered = needed.current && !helperNeeds;
		needed.current = helperNeeds;
		if (answered) setState((s) => (s.role === "helper" ? { ...s, role: "teacher", focus: false } : s));
	}, [helperNeeds]);

	// The key presses that hold the opening back while the learner writes.
	const lastKey = useRef<number | null>(null);
	useEffect(() => {
		const note = (e: KeyboardEvent) => {
			const el = e.target as HTMLElement | null;
			if (!el?.tagName) return;
			const inputType = el.tagName === "INPUT" ? (el as HTMLInputElement).type : "";
			if (isWritingBox({ tag: el.tagName, inputType, editable: el.isContentEditable, inTerminal: !!el.closest("[data-terminal-screen]") })) lastKey.current = Date.now();
		};
		document.addEventListener("keydown", note, true);
		return () => document.removeEventListener("keydown", note, true);
	}, []);

	const loaded = !!terminals?.loaded;
	const teacher = terminals?.facts.teacher ?? null;
	const need: TerminalRole | null = teacher && needsYou(teacher) ? "teacher" : helperNeeds ? "helper" : null;
	const seen = useRef(FIRST_LOOK);
	const started = useRef(false);
	// Counts up when the typing pause may have ended, so the step looks again.
	const [pause, pauseEnded] = useReducer((n: number) => n + 1, 0);
	const { open, byApp } = state;
	useEffect(() => {
		// What the terminals' first list shows is a start, not a change.
		if (!started.current) {
			started.current = loaded;
			seen.current = { need, replying, waiting: false };
			return;
		}
		const waitLeft = typingWaitLeft(lastKey.current, Date.now());
		const { mem, act } = stepPanel(seen.current, { need, replying }, { open, byApp }, waitLeft);
		seen.current = mem;
		if (act === "close") setState(CLOSED);
		else if (act) setState({ open: true, list: false, role: act.open, focus: false, byApp: true });
		else if (mem.waiting) {
			const timer = setTimeout(pauseEnded, waitLeft);
			return () => clearTimeout(timer);
		}
	}, [need, replying, open, byApp, loaded, pause]);

	return { ...state, setOpen, showTerminal, setList };
}
