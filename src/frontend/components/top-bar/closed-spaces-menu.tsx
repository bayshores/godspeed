import { useCallback, useRef, useState } from "react";
import { useSpaces } from "@/frontend/components/space-context";
import { spaceColorVar } from "@/frontend/components/space-color";
import { MenuShell } from "@/frontend/components/menu-shell";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { BAR_TAB, barTabState, MENU_ITEM } from "./bar-look";
import { SpaceMenu, useSpaceMenu } from "./space-menu";
import { useCloseSpace } from "./use-close-space";

/**
 * THE + after the last tab: "Add a space", then, when any space is closed,
 * one row per closed space. A click on a row reopens the space and
 * switches the window to it; a right-click opens its menu. `lit` while the
 * window shows a closed space.
 */
export function ClosedSpacesMenu({ lit, onAdd, onDelete }: { lit: boolean; onAdd: () => void; onDelete: (spaceId: string) => void }) {
	const { spaces } = useSpaces();
	const closed = spaces.filter((s) => s.archived);
	const [open, setOpen] = useState(false);
	const anchorRef = useRef<HTMLButtonElement>(null);
	const rowMenu = useSpaceMenu();
	const closeRowMenu = rowMenu.close;
	const close = useCallback(() => {
		setOpen(false);
		closeRowMenu();
	}, [closeRowMenu]);
	useMenuDismiss(open, close, anchorRef);
	const { busy, error, reopen } = useCloseSpace();
	const menuSpace = closed.find((s) => s.id === rowMenu.shownId);
	const name = closed.length > 0 ? "Add a space or reopen a closed one" : "Add a space";
	return (
		<>
			<button
				ref={anchorRef}
				type="button"
				data-testid="spaces-plus"
				aria-label={name}
				title={name}
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => (open ? close() : setOpen(true))}
				className={cn(BAR_TAB, "shrink-0", barTabState(lit || open))}
			>
				<PixelIcon name="plus" />
			</button>
			<MenuShell open={open} anchorRef={anchorRef} testid="spaces-plus-list" preferredSide="down" align="left" menuClass="lh-popup flex w-[260px] flex-col p-1.5">
				{/* A press inside the list, off a row's menu, closes that menu. */}
				<div className="flex flex-col" onPointerDown={closeRowMenu}>
					<button
						role="menuitem"
						type="button"
						data-testid="space-new"
						onClick={() => {
							close();
							onAdd();
						}}
						className={MENU_ITEM}
					>
						Add a space
					</button>
					{closed.length > 0 && (
						<div role="group" aria-labelledby="closed-spaces-word" className="flex flex-col">
							<div aria-hidden className="mx-3 my-1.5 border-t border-dotted border-edge" />
							<span id="closed-spaces-word" className="px-3 pt-1 pb-1 text-[15px] text-ink-2">
								Closed
							</span>
							{closed.map((s) => (
								<button
									key={s.id}
									role="menuitem"
									type="button"
									data-testid={`closed-space-${s.id}`}
									disabled={busy}
									onContextMenu={(e) => rowMenu.onContextMenu(e, s.id)}
									onClick={async () => {
										if (await reopen(s)) close();
									}}
									className={cn(MENU_ITEM, "gap-2", rowMenu.openId === s.id && "bg-accent")}
								>
									<span aria-hidden className="size-2.5 shrink-0" style={{ background: spaceColorVar(s.color) }} />
									<span title={s.name} className="min-w-0 truncate">
										{s.name}
									</span>
								</button>
							))}
						</div>
					)}
					{error && (
						<p role="alert" data-testid="spaces-plus-error" className="px-3 py-2 text-[15px] whitespace-pre-wrap text-ans-wrong">
							{error}
						</p>
					)}
				</div>
			</MenuShell>
			{/* Outside the list's element, so a press in it isn't a press in the list. */}
			{menuSpace && (
				<SpaceMenu
					key={menuSpace.id}
					space={menuSpace}
					open={rowMenu.openId === menuSpace.id}
					anchorRef={rowMenu.anchorRef}
					onScreen={false}
					onClose={close}
					onDelete={onDelete}
				/>
			)}
		</>
	);
}
