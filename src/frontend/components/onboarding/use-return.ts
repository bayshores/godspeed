import { useEffect, useRef } from "react";

/** Return presses the step's main button, unless typing in a field
 *  wants the key (a text area) or a modifier is held. */
export function useReturn(onReturn: (() => void) | null) {
	const ref = useRef(onReturn);
	ref.current = onReturn;
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.isComposing) return;
			if (e.target instanceof HTMLTextAreaElement) return;
			if (e.target instanceof HTMLButtonElement) return; // the button's own click
			if (!ref.current) return;
			e.preventDefault();
			ref.current();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
}
