import { useLayoutEffect, useState, type FocusEvent } from "react";

/**
 * True while a timed notice should wait instead of vanishing: while the
 * notice stack keeps it hidden (so its time starts once it shows), the
 * pointer is on it or focus is inside it (WCAG 2.2.1). Spread `handlers`
 * on the notice's root.
 */
export function useHeld() {
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
	return {
		held: pointer || focus || hidden,
		handlers: {
			ref: setNode,
			onPointerEnter: () => setPointer(true),
			onPointerLeave: () => setPointer(false),
			onFocus: () => setFocus(true),
			onBlur: (e: FocusEvent<HTMLElement>) => {
				if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
			},
		},
	};
}
