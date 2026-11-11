import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { kbdEventForAction } from "@/shared/core";
import { ClassDialog } from "@/frontend/components/class-dialog";
import { useClasses } from "@/frontend/components/class-context";
import { MenuShell } from "@/frontend/components/menu-shell";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { cn } from "@/frontend/lib/utils";
import { BAR_TAB, barTabState } from "./class-tabs";

const ITEM = "lh-press flex items-center px-3 py-2 text-left text-[15px] text-ink hover:bg-accent";

// The dialog compares its mode by identity: one object for every open.
const CREATE = { kind: "create" } as const;

/**
 * Menu, at the top bar's right: the places and actions that belong to no
 * one class. `lit` while the page on screen is one of them.
 */
export function AppMenu({ lit }: { lit: boolean }) {
	const router = useRouter();
	const { setActive } = useClasses();
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
					data-testid="class-new"
					onClick={() => {
						close();
						setCreating(true);
					}}
					className={ITEM}
				>
					Add a class
				</button>
				<button
					role="menuitem"
					type="button"
					data-testid="class-option-none"
					onClick={() => {
						close();
						setActive(null);
						router.push("/class/lessons");
					}}
					className={ITEM}
				>
					Lessons with no class
				</button>
				<Link role="menuitem" href="/archived" data-testid="menu-archived" onClick={close} className={ITEM}>
					Archived classes
				</Link>
				<div aria-hidden className="mx-3 my-1.5 border-t border-dotted border-edge" />
				<Link role="menuitem" href="/settings" data-testid="settings-entry" onClick={close} className={ITEM}>
					Settings
				</Link>
			</MenuShell>
			<ClassDialog mode={creating ? CREATE : null} onClose={() => setCreating(false)} />
		</>
	);
}
