/**
 * The teacher's panel state: open or not, and whether the Activity list
 * hangs from its head. The panel opens by itself when a card in its chat
 * waits to be allowed and closes when that is settled or a lesson reply
 * starts (panel-auto-model.ts); opened that way it leaves the keyboard where
 * it is. Only a panel the learner opened takes the keyboard. When the chat
 * pops out into its own window the panel closes; while it is there the panel
 * never opens by itself, and asking to show the chat brings the window
 * forward instead. Put back shows the chat here again. A new learner's first
 * look at Home opens it once.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useTerminals } from "@/frontend/components/terminal/use-terminals";
import { readStorage, writeStorage } from "@/frontend/lib/storage";
import { FIRST_LOOK, isWritingBox, stepPanel, typingWaitLeft, welcomeNow, WELCOME_KEY } from "./panel-auto-model";

interface PanelState {
	open: boolean;
	/** The Activity list hangs from the status chip. */
	list: boolean;
	/** The learner opened the panel: its box takes the keyboard. */
	focus: boolean;
	/** The panel opened by itself and the learner has not taken it over. */
	byApp: boolean;
}

const CLOSED: PanelState = { open: false, list: false, focus: false, byApp: false };

/** `replying`: a reply is running in the open lesson, null with no lesson open. `onHome`: Home is
 *  the page. `need`: a card in the panel's chat waits to be allowed. `loaded`: the chats were read. */
export function useTeacherPanel(replying: boolean | null, onHome: boolean, need: boolean, loaded: boolean) {
	const [state, setState] = useState<PanelState>(CLOSED);
	const showScreen = useCallback(() => setState({ open: true, list: false, focus: true, byApp: false }), []);
	// Opened by the learner, the panel is on its chat, or on Activity while that is in its own window.
	const setOpen = useCallback((open: boolean) => (open ? showScreen() : setState(CLOSED)), [showScreen]);
	const setList = useCallback((list: boolean) => setState((s) => ({ ...s, list })), []);

	const terminals = useTerminals();
	const popped = !!terminals?.popped;
	const focusWindow = terminals?.focusWindow;
	// Popped out, the chat has a window of its own: the column gives the page its room back.
	useEffect(() => {
		if (popped) setState(CLOSED);
	}, [popped]);
	// Put back, from either window: the chat shows here again, with the keyboard.
	const putBacks = terminals?.putBacks ?? 0;
	useEffect(() => {
		if (putBacks > 0) showScreen();
	}, [putBacks, showScreen]);
	// The chat is in its window while popped.
	const showChat = useCallback(() => (popped ? focusWindow?.() : showScreen()), [popped, focusWindow, showScreen]);

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

	useEffect(() => {
		if (!welcomeNow({ marked: readStorage(WELCOME_KEY) !== null, onHome, teacherOn: loaded })) return;
		writeStorage(WELCOME_KEY, null);
		// Already open, or in its own window, the learner has it in front of them. It answers no
		// need, so no need settling closes it; the keyboard stays where it is.
		setState((s) => (s.open || popped ? s : { open: true, list: false, focus: false, byApp: false }));
	}, [onHome, loaded, popped]);
	const seen = useRef(FIRST_LOOK);
	const started = useRef(false);
	// Counts up when the typing pause may have ended, so the step looks again.
	const [pause, pauseEnded] = useReducer((n: number) => n + 1, 0);
	const { open, byApp } = state;
	useEffect(() => {
		// What the chats' first read shows is a start, not a change.
		if (!started.current) {
			started.current = loaded;
			seen.current = { need, replying, waiting: false };
			return;
		}
		const waitLeft = typingWaitLeft(lastKey.current, Date.now());
		const { mem, act } = stepPanel(seen.current, { need, replying }, { open, byApp, popped }, waitLeft);
		seen.current = mem;
		if (act === "close") setState(CLOSED);
		else if (act === "open") setState({ open: true, list: false, focus: false, byApp: true });
		else if (mem.waiting) {
			const timer = setTimeout(pauseEnded, waitLeft);
			return () => clearTimeout(timer);
		}
	}, [need, replying, open, byApp, popped, loaded, pause]);

	return { ...state, setOpen, showChat, setList };
}
