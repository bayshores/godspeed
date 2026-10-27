/**
 * The Graph page's two small menus (the exam picker and a fact's
 * right-click menu) share one dismissal rule: a pointerdown outside the
 * anchor and outside the menu closes it, and so does Escape (claimed, so
 * nothing under the menu also acts). Placement is MenuShell's.
 */
import { useEffect, type RefObject } from "react";

export const MENU_CLASS = "flex w-fit min-w-40 flex-col gap-0.5 border border-tone-2 bg-panel p-1.5 text-[13.5px] shadow-xl";
export const MENU_ITEM_CLASS =
	"lh-press flex items-center gap-2 px-2.5 py-1.5 text-left text-ink-2 hover:bg-tone hover:text-ink focus-visible:bg-tone focus-visible:text-ink outline-none";

export function useMenuDismiss(open: boolean, close: () => void, anchorRef: RefObject<HTMLElement | null>): void {
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as Node;
			if (target instanceof Element && target.closest("[data-lh-menu]")) return;
			if (anchorRef.current?.contains(target)) return;
			close();
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopPropagation();
			close();
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open, close, anchorRef]);
}
