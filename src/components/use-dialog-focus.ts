import { useEffect, useRef, type RefObject } from "react";

/**
 * Moves focus into a modal dialog when it opens and gives it back when it
 * closes. Focus lands on the control marked data-autofocus, or on the
 * dialog itself (give it tabIndex={-1}) so a screen reader reads its name.
 * Focus goes back only to a keyboard user (the focus ring was on at open),
 * and only if the closing action didn't move it elsewhere: a mouse user's
 * clicked button must not take the lesson's next Enter (enter-submits.ts).
 * Tab stays inside through trapTabInDialog (focus-hygiene.ts).
 */
export function useDialogFocus<T extends HTMLElement>(open = true): RefObject<T | null> {
	const ref = useRef<T | null>(null);
	useEffect(() => {
		const dialog = ref.current;
		if (!open || !dialog) return;
		const before = document.activeElement as HTMLElement | null;
		const keyboard = document.documentElement.hasAttribute("data-tab-focus");
		if (!dialog.contains(before)) (dialog.querySelector<HTMLElement>("[data-autofocus]") ?? dialog).focus({ preventScroll: true });
		return () => {
			if (!keyboard || !before || before === document.body || !before.isConnected || dialog.contains(before)) return;
			const now = document.activeElement;
			if (!now || now === document.body || dialog.contains(now)) before.focus({ preventScroll: true });
		};
	}, [open]);
	return ref;
}
