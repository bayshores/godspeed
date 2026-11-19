import { useEffect, useLayoutEffect, useState, type FocusEvent } from "react";

/**
 * A timed notice: `onExpire` runs `after` ms after it shows (null: it waits
 * for the learner), and the time starts again when `restartOn` changes. The
 * clock waits while the notice stack keeps it hidden, the pointer is on it
 * or focus is inside it (WCAG 2.2.1). Spread the result on the notice's root.
 */
export function useHeld(after: number | null, onExpire: () => void, restartOn?: unknown) {
	const [pointer, setPointer] = useState(false);
	const [focus, setFocus] = useState(false);
	const [node, setNode] = useState<HTMLElement | null>(null);
	const [hidden, setHidden] = useState(false);
	useLayoutEffect(() => {
		if (!node) return;
		const read = () => setHidden(node.hasAttribute("hidden"));
		read();
		const observer = new MutationObserver(read);
		observer.observe(node, { attributes: true, attributeFilter: ["hidden"] });
		return () => observer.disconnect();
	}, [node]);
	const held = pointer || focus || hidden;
	useEffect(() => {
		if (held || after === null) return;
		const timer = window.setTimeout(onExpire, after);
		return () => window.clearTimeout(timer);
	}, [held, after, onExpire, restartOn]);
	return {
		ref: setNode,
		onPointerEnter: () => setPointer(true),
		onPointerLeave: () => setPointer(false),
		onFocus: () => setFocus(true),
		onBlur: (e: FocusEvent<HTMLElement>) => {
			if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
		},
	};
}
