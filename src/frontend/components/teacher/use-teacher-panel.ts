/**
 * The teacher's panel state: open or not, whether the Activity list hangs
 * from its status chip, and which screen it shows. The teacher's screen is
 * the panel's own; background work's screen shows only while it needs the
 * learner (or Settings opens it), and the panel goes back to the teacher's
 * once that need is answered. The panel opens by itself when an agent's
 * terminal needs the learner and closes when that is settled or a lesson
 * reply starts (panel-auto-model.ts); opened that way it leaves the keyboard
 * where it is. Only a screen the learner opened takes the keyboard. When the
 * teacher's screen pops out into its own window the panel closes; while it is
 * there the panel never opens by itself, and asking to show that screen
 * brings the window forward instead. Put back shows the screen here again.
 * A new learner's first Today with the teacher on opens it once.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { needsYou, type TerminalRole } from "@/frontend/components/terminal/terminal-model";
import { useTerminals } from "@/frontend/components/terminal/use-terminals";
import { readStorage, writeStorage } from "@/frontend/lib/storage";
import { FIRST_LOOK, isWritingBox, stepPanel, typingWaitLeft, welcomeNow, WELCOME_KEY } from "./panel-auto-model";

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

/** `replying`: a reply is running in the open lesson, null with no lesson open. `onToday`: Today is the page. */
export function useTeacherPanel(replying: boolean | null, onToday: boolean) {
	const [state, setState] = useState<PanelState>(CLOSED);
	const showScreen = useCallback((role: TerminalRole) => setState({ open: true, list: false, role, focus: true, byApp: false }), []);
	// Opened by the learner, the panel is on the teacher's screen, or on Activity while that is in its own window.
	const setOpen = useCallback((open: boolean) => (open ? showScreen("teacher") : setState(CLOSED)), [showScreen]);
	const setList = useCallback((list: boolean) => setState((s) => ({ ...s, list })), []);

	const terminals = useTerminals();
	const popped = !!terminals?.popped;
	const focusWindow = terminals?.focusWindow;
	// Popped out, the terminal has a window of its own: the column gives the page its room back.
	useEffect(() => {
		if (popped) setState(CLOSED);
	}, [popped]);
	// Put back, from either window: the screen shows here again, with the keyboard.
	const putBacks = terminals?.putBacks ?? 0;
	useEffect(() => {
		if (putBacks > 0) showScreen("teacher");
	}, [putBacks, showScreen]);
	// The teacher's screen is in its window while popped; background work's still shows here.
	const showTerminal = useCallback(
		(role: TerminalRole = "teacher") => (popped && role === "teacher" ? focusWindow?.() : showScreen(role)),
		[popped, focusWindow, showScreen],
	);
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
	const teacherOn = !!teacher && !teacher.term.ended;
	useEffect(() => {
		if (!welcomeNow({ marked: readStorage(WELCOME_KEY) !== null, onToday, teacherOn })) return;
		writeStorage(WELCOME_KEY, null);
		// Already open, or in its own window, the learner has it in front of them.
		setState((s) => (s.open || popped ? s : { open: true, list: false, role: "teacher", focus: false, byApp: true }));
	}, [onToday, teacherOn, popped]);
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
		const { mem, act } = stepPanel(seen.current, { need, replying }, { open, byApp, popped }, waitLeft);
		seen.current = mem;
		if (act === "close") setState(CLOSED);
		else if (act) setState({ open: true, list: false, role: act.open, focus: false, byApp: true });
		else if (mem.waiting) {
			const timer = setTimeout(pauseEnded, waitLeft);
			return () => clearTimeout(timer);
		}
	}, [need, replying, open, byApp, popped, loaded, pause]);

	return { ...state, setOpen, showTerminal, showScreen, setList };
}
