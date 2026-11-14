import { useCallback, useRef, useState, type MouseEvent, type RefObject } from "react";
import type { SpaceSummary } from "@/shared/core";
import { MenuShell } from "@/frontend/components/menu-shell";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { cn } from "@/frontend/lib/utils";
import { MENU_ITEM } from "./bar-look";
import { useCloseSpace } from "./use-close-space";

/**
 * A SPACE'S MENU, on a right-click of its tab or of its row under Closed:
 * Close (Reopen for a closed space) and Delete space. MenuShell owns
 * placement, focus and arrow keys; useSpaceMenu owns dismissal.
 */

/** Which space's menu is open and what it hangs from. The last space stays
 *  set after closing so the menu can play its exit. */
export function useSpaceMenu() {
	const [openId, setOpenId] = useState<string | null>(null);
	const [shownId, setShownId] = useState<string | null>(null);
	const anchorRef = useRef<HTMLElement | null>(null);
	const close = useCallback(() => setOpenId(null), []);
	useMenuDismiss(openId !== null, close, anchorRef);
	/** The right-click (or the context-menu key on a focused tab). */
	const onContextMenu = useCallback((e: MouseEvent<HTMLElement>, id: string) => {
		e.preventDefault(); // this menu instead of the browser's
		anchorRef.current = e.currentTarget;
		setOpenId(id);
		setShownId(id);
	}, []);
	return { openId, shownId, anchorRef, close, onContextMenu };
}

export function SpaceMenu({
	space,
	open,
	anchorRef,
	onScreen,
	onClose,
	onDelete,
}: {
	space: SpaceSummary;
	open: boolean;
	anchorRef: RefObject<HTMLElement | null>;
	/** Its tab is the lit one: closing it goes to Today. */
	onScreen: boolean;
	onClose: () => void;
	onDelete: (spaceId: string) => void;
}) {
	const { busy, error, close, reopen } = useCloseSpace();
	return (
		<MenuShell open={open} anchorRef={anchorRef} testid="space-menu" preferredSide="down" align="left" menuClass="lh-popup flex w-[220px] flex-col p-1.5">
			<button
				role="menuitem"
				type="button"
				data-testid="space-menu-close"
				disabled={busy}
				onClick={async () => {
					if (await (space.archived ? reopen(space) : close(space, onScreen))) onClose();
				}}
				className={MENU_ITEM}
			>
				{space.archived ? "Reopen" : "Close"}
			</button>
			<button
				role="menuitem"
				type="button"
				data-testid="space-menu-delete"
				disabled={busy}
				onClick={() => {
					onClose();
					onDelete(space.id);
				}}
				className={cn(MENU_ITEM, "text-ans-wrong")}
			>
				Delete space
			</button>
			{error && (
				<p role="alert" data-testid="space-menu-error" className="px-3 py-2 text-[15px] whitespace-pre-wrap text-ans-wrong">
					{error}
				</p>
			)}
		</MenuShell>
	);
}
