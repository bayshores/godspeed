import { useEffect, type RefObject } from "react";

/** The open menus, oldest first: Escape is the newest one's, so a menu
 *  opened from inside another closes alone. */
const openMenus: symbol[] = [];

/** The app's menu contract: a pointerdown outside the menu and its
 *  trigger closes it; Escape is claimed (it never also closes a dialog or
 *  aborts a turn) and focus returns to the trigger. */
export function useMenuDismiss(open: boolean, close: () => void, anchorRef: RefObject<HTMLElement | null>): void {
	useEffect(() => {
		if (!open) return;
		const me = Symbol();
		openMenus.push(me);
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as Node;
			if (target instanceof Element && target.closest("[data-lh-menu]")) return;
			if (anchorRef.current?.contains(target)) return;
			close();
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				if (openMenus.at(-1) !== me) return;
				close();
				anchorRef.current?.focus();
			}
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			openMenus.splice(openMenus.indexOf(me), 1);
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open, close, anchorRef]);
}
