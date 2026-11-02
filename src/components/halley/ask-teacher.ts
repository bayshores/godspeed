/**
 * Ask the teacher from anywhere in the window: opens the teacher's panel on
 * Talk and sends the message there. A window event, like settings-signal,
 * because the asking button and the panel live in different subtrees.
 */
import { useEffect, useRef } from "react";

const ASK_TEACHER_EVENT = "lh:ask-teacher";

export function askTeacher(text: string): void {
	window.dispatchEvent(new CustomEvent(ASK_TEACHER_EVENT, { detail: { text } }));
}

/** The panel's side: called with each message to send. */
export function useAskTeacher(handler: (text: string) => void): void {
	const saved = useRef(handler);
	saved.current = handler;
	useEffect(() => {
		const listener = (e: Event) => {
			const text = (e as CustomEvent<{ text?: unknown }>).detail?.text;
			if (typeof text === "string" && text.trim()) saved.current(text);
		};
		window.addEventListener(ASK_TEACHER_EVENT, listener);
		return () => window.removeEventListener(ASK_TEACHER_EVENT, listener);
	}, []);
}
