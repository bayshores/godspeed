/**
 * The window the teacher panel's chat pops out to, as the main window sees it: whether it is open,
 * how many times a page asked to put the chat back, and the keys that open, bring forward and close
 * it. Outside the desktop app there is no such window: `popOut` is null and nothing else acts.
 */
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";

/** A shell refusal's sentence, or null when it went through. */
const refusal = (p: Promise<void>): Promise<string | null> => p.then(() => null, (err: unknown) => (typeof err === "string" ? err : null));

export interface ChatWindow {
	/** The chat is in its own window. */
	popped: boolean;
	/** Pops the chat out, or brings its window forward, titled with the teacher's name. Resolves to
	 *  why the shell refused, or null. Null in a browser. */
	popOut: ((name: string) => Promise<string | null>) | null;
	/** Brings the chat's window forward. */
	focusWindow: () => void;
	/** Closes the chat's window and has the main window's panel show the chat again. */
	putBack: () => void;
	/** How many times a page asked for that: the panel shows its chat at each. */
	putBacks: number;
}

export function useChatWindow(): ChatWindow {
	const lh = typeof window === "undefined" ? undefined : window.lh?.chatWindow;
	// The shell says whether the window is open as it opens or closes, and after each load of this page.
	const [popped, setPopped] = useState(false);
	const [putBacks, countPutBack] = useReducer((n: number) => n + 1, 0);
	useEffect(() => {
		if (!lh) return;
		return lh.onChange(({ open, back }) => {
			setPopped(open);
			if (back) countPutBack();
		});
	}, [lh]);
	const popOut = useMemo(() => (lh ? (name: string) => refusal(lh.open(name)) : null), [lh]);
	// A window closed or not open any more is what these wanted.
	const focusWindow = useCallback(() => void lh?.focus().catch(() => {/* it closed since */}), [lh]);
	const putBack = useCallback(() => void lh?.close().catch(() => {/* it is gone already */}), [lh]);
	return useMemo(() => ({ popped, popOut, focusWindow, putBack, putBacks }), [popped, popOut, focusWindow, putBack, putBacks]);
}
