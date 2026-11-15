/**
 * The teacher's panel state: open or not, whether the Activity list hangs
 * from its status chip, and which screen it shows. The teacher's screen is
 * the panel's own; background work's screen shows only while it needs the
 * learner (or Settings opens it), and the panel goes back to the teacher's
 * once that need is answered. The panel never opens by itself, and only a
 * screen the learner opened takes the keyboard.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { needsYou, type TerminalRole } from "@/frontend/components/terminal/terminal-model";
import { useTerminals } from "@/frontend/components/terminal/use-terminals";

interface PanelState {
	open: boolean;
	/** The Activity list hangs from the status chip. */
	list: boolean;
	/** The screen the panel shows. */
	role: TerminalRole;
	/** The learner opened that screen: it takes the keyboard. */
	focus: boolean;
}

const CLOSED: PanelState = { open: false, list: false, role: "teacher", focus: false };

export function useTeacherPanel() {
	const [state, setState] = useState<PanelState>(CLOSED);
	const setOpen = useCallback((open: boolean) => setState(open ? { ...CLOSED, open } : CLOSED), []);
	const showTerminal = useCallback((role: TerminalRole = "teacher") => setState({ open: true, list: false, role, focus: true }), []);
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

	return { ...state, setOpen, showTerminal, setList };
}
