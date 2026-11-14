import { useCallback, useRef, useState } from "react";
import { Link } from "react-router";
import { kbdEventForAction } from "@/shared/core";
import { MenuShell } from "@/frontend/components/menu-shell";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { cn } from "@/frontend/lib/utils";
import { BAR_TAB, barTabState, MENU_ITEM } from "./bar-look";

/**
 * Menu, at the top bar's right: Search lessons and Settings. `lit` while
 * Settings is on screen.
 */
export function AppMenu({ lit }: { lit: boolean }) {
	const [open, setOpen] = useState(false);
	const anchorRef = useRef<HTMLButtonElement>(null);
	const close = useCallback(() => setOpen(false), []);
	useMenuDismiss(open, close, anchorRef);
	return (
		<>
			<button
				ref={anchorRef}
				type="button"
				data-testid="app-menu"
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
				className={cn(BAR_TAB, "shrink-0", barTabState(lit || open))}
			>
				Menu
			</button>
			<MenuShell open={open} anchorRef={anchorRef} testid="app-menu-list" preferredSide="down" menuClass="lh-popup flex w-[250px] flex-col p-1.5">
				<button
					role="menuitem"
					type="button"
					data-testid="menu-search-lessons"
					onClick={() => {
						close();
						window.dispatchEvent(new CustomEvent(kbdEventForAction("sessions-search")));
					}}
					className={MENU_ITEM}
				>
					Search lessons
				</button>
				<Link role="menuitem" to="/settings" data-testid="settings-entry" onClick={close} className={MENU_ITEM}>
					Settings
				</Link>
			</MenuShell>
		</>
	);
}
