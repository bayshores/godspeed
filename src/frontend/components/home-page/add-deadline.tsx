import { useCallback, useRef, useState } from "react";
import type { SpaceSummary } from "@/shared/core";
import { MenuShell } from "@/frontend/components/menu-shell";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { SpaceMenuItems } from "./space-menu-items";

/** The deadlines card's "Add" key: one space opens its dialog at once;
 *  several open a menu of spaces first. */
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
				aria-label="Add a deadline"
				aria-haspopup={single ? undefined : "menu"}
				aria-expanded={single ? undefined : open}
				onClick={() => (single ? onPick(single.id) : setOpen((v) => !v))}
				className="lh-btn lh-btn-quiet"
			>
				<PixelIcon name="plus" />
				Add
			</button>
			{!single && (
				<MenuShell open={open} anchorRef={anchorRef} testid="home-add-deadline-menu" preferredSide="down" align="right" menuClass="lh-popup flex w-[236px] flex-col gap-0.5 p-1.5">
					<span className="px-2.5 py-1 text-sm text-ink-2">Which space?</span>
					<SpaceMenuItems
						spaces={spaces}
						testidPrefix="home-add-deadline"
						onPick={(id) => {
							setOpen(false);
							onPick(id);
						}}
					/>
				</MenuShell>
			)}
		</>
	);
}
