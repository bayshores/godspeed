/**
 * The teacher's panel state: open or not, its tab, and which screen the
 * Terminal tab shows. The learner opens it (the top bar chip, a status
 * line, a Start button, askTeacher on Talk); a screen that needs the
 * learner opens it on Terminal by itself, only while it is closed and
 * without the keyboard. While it is open on another tab, the Terminal tab
 * carries a mark instead (teacher-panel.tsx).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { TerminalRole } from "@/frontend/components/terminal/terminal-model";
import { useTerminals } from "@/frontend/components/terminal/use-terminals";
import { useAskTeacher } from "./ask-teacher";
import type { PanelTab } from "./dock-model";
import type { TalkAsk } from "./talk-view";

interface PanelState {
	open: boolean;
	tab: PanelTab;
	/** The screen the Terminal tab shows. */
	role: TerminalRole;
	/** The learner opened that screen: it takes the keyboard. */
	focus: boolean;
}

const CLOSED: PanelState = { open: false, tab: "talk", role: "teacher", focus: false };

export function useTeacherPanel() {
	const [state, setState] = useState<PanelState>(CLOSED);
	/** Opening shows Talk; closing keeps nothing. */
	const setOpen = useCallback((open: boolean) => setState(open ? { ...CLOSED, open } : CLOSED), []);
	const showActivity = useCallback(() => setState({ ...CLOSED, open: true, tab: "activity" }), []);
	const showTerminal = useCallback((role: TerminalRole = "teacher") => setState({ open: true, tab: "terminal", role, focus: true }), []);
	/** The learner picks a tab or a screen in the panel. */
	const setTab = useCallback((tab: PanelTab) => setState((s) => ({ ...s, tab, focus: tab === "terminal" })), []);
	const setRole = useCallback((role: TerminalRole) => setState((s) => ({ ...s, role, focus: true })), []);

	// A message asked from elsewhere (askTeacher), until Talk sends it.
	const [ask, setAsk] = useState<TalkAsk | null>(null);
	const askCount = useRef(0);
	useAskTeacher((text) => {
		setAsk({ id: ++askCount.current, text });
		setState({ ...CLOSED, open: true });
	});
	const onAsked = useCallback((id: number) => setAsk((a) => (a?.id === id ? null : a)), []);

	// A screen needs the learner: heard here once. A closed panel opens on
	// it; an open one leaves the learner where they are and marks the tab.
	const terminals = useTerminals();
	const calling = terminals?.calling ?? null;
	const heard = terminals?.heard;
	useEffect(() => {
		if (!calling || !heard) return;
		heard(calling.key);
		setState((s) => (s.open ? s : { open: true, tab: "terminal", role: calling.role, focus: false }));
	}, [calling, heard]);

	return { ...state, setOpen, showActivity, showTerminal, setTab, setRole, ask, onAsked };
}
