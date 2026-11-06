import { useState, type FocusEvent } from "react";

/**
 * True while the pointer is on a timed notice or focus is inside it, so
 * the notice waits instead of vanishing under the reader (WCAG 2.2.1).
 * Spread `handlers` on the notice's root.
 */
export function useHeld() {
	const [pointer, setPointer] = useState(false);
	const [focus, setFocus] = useState(false);
	return {
		held: pointer || focus,
		handlers: {
			onPointerEnter: () => setPointer(true),
			onPointerLeave: () => setPointer(false),
			onFocus: () => setFocus(true),
			onBlur: (e: FocusEvent<HTMLElement>) => {
				if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
			},
		},
	};
}
