import { useCallback, useRef, useState } from "react";
import type { SpaceSummary } from "@/shared/core";
import { spaceColorVar } from "@/frontend/components/space-color";
import { MenuShell } from "@/frontend/components/menu-shell";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";

/** "Add a deadline": one space opens its Deadlines tab at once; several open
 *  a menu of spaces first. */
export function AddDeadline({ spaces, onPick }: { spaces: readonly SpaceSummary[]; onPick: (spaceId: string) => void }) {
	const [open, setOpen] = useState(false);
	const anchorRef = useRef<HTMLButtonElement>(null);
	const close = useCallback(() => setOpen(false), []);
	useMenuDismiss(open, close, anchorRef);

	const single = spaces.length === 1 ? spaces[0]! : null;
	return (
		<>
			<button
				ref={anchorRef}
				type="button"
				data-testid="home-add-deadline"
				aria-haspopup={single ? undefined : "menu"}
				aria-expanded={single ? undefined : open}
				onClick={() => (single ? onPick(single.id) : setOpen((v) => !v))}
				className="lh-btn lh-btn-quiet -mr-[7.5px] h-[38px] text-[15px]"
			>
				<PixelIcon name="plus" />
				Add a deadline
			</button>
			{!single && (
				<MenuShell open={open} anchorRef={anchorRef} testid="home-add-deadline-menu" preferredSide="down" align="right" menuClass="lh-popup flex w-[236px] flex-col gap-0.5 p-1.5">
					<span className="px-2.5 py-1 text-sm text-ink-2">Which space?</span>
					{spaces.map((c) => (
						<button
							role="menuitem"
							key={c.id}
							type="button"
							data-testid={`home-add-deadline-${c.id}`}
							onClick={() => {
								setOpen(false);
								onPick(c.id);
							}}
							className="lh-press flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-[15px] text-ink hover:bg-tone"
						>
							<span aria-hidden className="size-3 shrink-0" style={{ background: spaceColorVar(c.color) }} />
							<span title={c.name} className="min-w-0 flex-1 truncate">
								{c.name}
							</span>
						</button>
					))}
				</MenuShell>
			)}
		</>
	);
}
