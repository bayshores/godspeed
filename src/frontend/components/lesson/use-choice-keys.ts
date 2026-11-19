import { useEffect, useRef, useState } from "react";

/** Whether a key press happened in a field, where keys keep their own meaning. */
export function typingIn(target: HTMLElement | null): boolean {
	return !!target && ((target.tagName === "INPUT" && (target as HTMLInputElement).type !== "range") || target.tagName === "TEXTAREA" || target.isContentEditable);
}

/**
 * The keyboard for a list of choice rows (`data-kbdrow`) inside the element `rootRef` is put on.
 * 1 to 9 pick a row, up and down walk them (clamped at the ends), Space acts on the walked row
 * like a click, Enter runs `onEnter` once a row was walked, and Tab from the rows goes to the
 * writing box through `onLeaveRows`. Keys typed into a field keep their meaning, and
 * modifier combinations are never ours. `onEnter` is null while there is nothing to submit.
 */
export function useChoiceKeys({ count, toggle, onLeaveRows, onEnter }: { count: number; toggle: (index: number) => void; onLeaveRows: () => void; onEnter: (() => void) | null }) {
	const [walked, setWalked] = useState<number | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);

	const focusRow = (index: number) => {
		const row = rootRef.current?.querySelector<HTMLElement>(`[data-kbdrow="${index}"]`);
		if (!row) return;
		(row.querySelector<HTMLElement>("input") ?? row).focus();
	};

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (count === 0) return;
			const t = e.target as HTMLElement | null;
			const modded = e.altKey || e.metaKey || e.ctrlKey;
			// Tab is ours only from the rows or nowhere; elsewhere (the writing
			// box included) it moves on as usual, so the send key stays reachable.
			const ownsTab = !t || t === document.body || !!t.closest?.("[data-kbdrow]");
			if (e.key === "Tab" && !e.shiftKey && !modded && ownsTab) {
				e.preventDefault();
				e.stopPropagation();
				if (t?.closest?.("[data-kbdrow]")) onLeaveRows();
				else {
					const index = walked ?? 0;
					setWalked(index);
					focusRow(index);
				}
				return;
			}
			if (typingIn(t) || modded) return;
			if (/^[1-9]$/.test(e.key)) {
				const n = Number(e.key);
				if (n <= count) {
					e.preventDefault();
					setWalked(n - 1);
					toggle(n - 1);
				}
			} else if (e.key === "ArrowDown") {
				e.preventDefault();
				const next = Math.min((walked ?? -1) + 1, count - 1);
				setWalked(next);
				if (t?.closest?.("[data-kbdrow]")) focusRow(next);
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				const next = Math.max((walked ?? count) - 1, 0);
				setWalked(next);
				if (t?.closest?.("[data-kbdrow]")) focusRow(next);
			} else if (e.key === " ") {
				if (walked === null) return; // plain Space keeps scrolling
				e.preventDefault();
				toggle(walked);
			} else if (e.key === "Enter") {
				if (walked === null || !onEnter) return;
				e.preventDefault();
				// The lesson's own Enter listener must not submit it again.
				e.stopPropagation();
				onEnter();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	});

	// Keep the walked row visible (the column scrolls).
	useEffect(() => {
		if (walked === null) return;
		rootRef.current?.querySelector(`[data-kbdrow="${walked}"]`)?.scrollIntoView({ block: "nearest" });
	}, [walked]);

	return { rootRef, walked };
}
