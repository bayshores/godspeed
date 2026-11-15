/**
 * The teacher's panel state: open or not, what it shows (the agent's
 * screen or Activity), and which screen. The learner opens it (the top
 * bar chip, a status line, a Start button); a screen that needs the
 * learner opens it on the screen by itself, only while it is closed and
 * without the keyboard. While it is open on Activity, the key back to the
 * screen carries a mark instead (teacher-panel.tsx).
 */
import { useCallback, useEffect, useState } from "react";
import type { TerminalRole } from "@/frontend/components/terminal/terminal-model";
import { useTerminals } from "@/frontend/components/terminal/use-terminals";
import type { PanelView } from "./dock-model";

interface PanelState {
	open: boolean;
	view: PanelView;
	/** The screen the panel shows. */
	role: TerminalRole;
	/** The learner opened that screen: it takes the keyboard. */
	focus: boolean;
}

const CLOSED: PanelState = { open: false, view: "terminal", role: "teacher", focus: false };

export function useTeacherPanel() {
	const [state, setState] = useState<PanelState>(CLOSED);
	const setOpen = useCallback((open: boolean) => setState(open ? { ...CLOSED, open } : CLOSED), []);
	const showActivity = useCallback(() => setState({ ...CLOSED, open: true, view: "activity" }), []);
	const showTerminal = useCallback((role: TerminalRole = "teacher") => setState({ open: true, view: "terminal", role, focus: true }), []);
	/** The learner swaps between the screen and Activity, or picks a screen. */
	const setView = useCallback((view: PanelView) => setState((s) => ({ ...s, view, focus: view === "terminal" })), []);
	const setRole = useCallback((role: TerminalRole) => setState((s) => ({ ...s, role, focus: true })), []);

	// A screen needs the learner: heard here once. A closed panel opens on
	// it; an open one leaves the learner where they are and marks the key.
	const terminals = useTerminals();
	const calling = terminals?.calling ?? null;
	const heard = terminals?.heard;
	useEffect(() => {
		if (!calling || !heard) return;
		heard(calling.key);
		setState((s) => (s.open ? s : { open: true, view: "terminal", role: calling.role, focus: false }));
	}, [calling, heard]);

	return { ...state, setOpen, showActivity, showTerminal, setView, setRole };
}
