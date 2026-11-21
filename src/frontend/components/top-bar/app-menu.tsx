import { useCallback, useRef, useState } from "react";
import { Link } from "react-router";
import { kbdEventForAction } from "@/shared/core";
import { KeyHint, keyShortcutProps } from "@/frontend/components/ui/key-hint";
import { MenuShell } from "@/frontend/components/menu-shell";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { cn } from "@/frontend/lib/utils";
import { barWord, MENU_ITEM } from "./bar-look";

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
				// A new key when Settings comes or goes, so the lit look is there with the page instead of
				// fading in; opening the menu still eases.
				key={lit ? "lit" : "unlit"}
				ref={anchorRef}
				type="button"
				data-testid="app-menu"
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
				className={barWord(open || lit)}
			>
				Menu
			</button>
			<MenuShell open={open} anchorRef={anchorRef} testid="app-menu-list" preferredSide="down" hang menuClass="lh-popup flex w-[250px] flex-col p-1.5">
				<button
					role="menuitem"
					type="button"
					data-testid="menu-search-lessons"
					onClick={() => {
						close();
						window.dispatchEvent(new CustomEvent(kbdEventForAction("sessions-search")));
					}}
					{...keyShortcutProps("sessions-search")}
					className={cn(MENU_ITEM, "justify-between gap-2")}
				>
					Search lessons
					<KeyHint action="sessions-search" />
				</button>
				<Link role="menuitem" to="/settings" data-testid="settings-entry" onClick={close} {...keyShortcutProps("open-settings")} className={cn(MENU_ITEM, "justify-between gap-2")}>
					Settings
					<KeyHint action="open-settings" />
				</Link>
			</MenuShell>
		</>
	);
}
