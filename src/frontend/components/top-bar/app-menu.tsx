import { useCallback, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { kbdEventForAction } from "@/shared/core";
import { SpaceDialog } from "@/frontend/components/space-dialog";
import { useSpaces } from "@/frontend/components/space-context";
import { MenuShell } from "@/frontend/components/menu-shell";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { cn } from "@/frontend/lib/utils";
import { BAR_TAB, barTabState } from "./space-tabs";

const ITEM = "lh-press flex items-center px-3 py-2 text-left text-[15px] text-ink hover:bg-accent";

// The dialog compares its mode by identity: one object for every open.
const CREATE = { kind: "create" } as const;

/**
 * Menu, at the top bar's right: the places and actions that belong to no
 * one space. `lit` while the page on screen is one of them.
 */
export function AppMenu({ lit }: { lit: boolean }) {
	const navigate = useNavigate();
	const { setActive } = useSpaces();
	const [open, setOpen] = useState(false);
	const [creating, setCreating] = useState(false);
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
					className={ITEM}
				>
					Search lessons
				</button>
				<button
					role="menuitem"
					type="button"
					data-testid="space-new"
					onClick={() => {
						close();
						setCreating(true);
					}}
					className={ITEM}
				>
					Add a space
				</button>
				<button
					role="menuitem"
					type="button"
					data-testid="space-option-none"
					onClick={() => {
						close();
						setActive(null);
						navigate("/space/lessons");
					}}
					className={ITEM}
				>
					Lessons with no space
				</button>
				<Link role="menuitem" to="/archived" data-testid="menu-archived" onClick={close} className={ITEM}>
					Archived spaces
				</Link>
				<div aria-hidden className="mx-3 my-1.5 border-t border-dotted border-edge" />
				<Link role="menuitem" to="/settings" data-testid="settings-entry" onClick={close} className={ITEM}>
					Settings
				</Link>
			</MenuShell>
			<SpaceDialog mode={creating ? CREATE : null} onClose={() => setCreating(false)} />
		</>
	);
}
