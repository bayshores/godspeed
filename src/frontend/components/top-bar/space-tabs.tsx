import { useState } from "react";
import { Link } from "react-router";
import { useSpaces } from "@/frontend/components/space-context";
import { spaceColorVar } from "@/frontend/components/space-color";
import { SpaceDialog, type SpaceDialogMode } from "@/frontend/components/space-dialog";
import { tabWorkTag } from "@/frontend/components/work/work-model";
import { cn } from "@/frontend/lib/utils";
import { BAR_TAB, barTabState } from "./bar-look";
import { ClosedSpacesMenu } from "./closed-spaces-menu";
import { SpaceMenu, useSpaceMenu } from "./space-menu";

// The dialog compares its mode by identity: one object for every open.
const CREATE = { kind: "create" } as const;

/**
 * Today, then one tab per open space, then the + (add a space, reopen a
 * closed one). A space's tab switches the window to it and opens its
 * Progress page; a right-click opens its menu. It carries a tag while the
 * teacher still has files of it to read.
 */
export function SpaceTabs({ selected }: { selected: string }) {
	const { spaces, setActive } = useSpaces();
	const tabMenu = useSpaceMenu();
	const [dialog, setDialog] = useState<SpaceDialogMode | null>(null);
	const onDelete = (spaceId: string) => setDialog({ kind: "delete", spaceId });
	const openSpaces = spaces.filter((s) => !s.archived);
	const menuSpace = openSpaces.find((s) => s.id === tabMenu.shownId);
	return (
		<nav aria-label="Spaces" data-testid="space-tabs" className="flex min-w-0 flex-1 items-stretch overflow-hidden">
			<Link to="/" data-testid="nav-today" aria-current={selected === "today" ? "page" : undefined} className={cn(BAR_TAB, "shrink-0", barTabState(selected === "today"))}>
				Today
			</Link>
			{openSpaces.map((c) => {
				const tag = tabWorkTag(c);
				const lit = selected === c.id;
				return (
					<Link
						key={c.id}
						to="/space"
						data-testid={`space-option-${c.id}`}
						data-teacher-target={`space:${c.id}`}
						aria-current={lit ? "page" : undefined}
						onClick={() => setActive(c.id)}
						onContextMenu={(e) => tabMenu.onContextMenu(e, c.id)}
						className={cn(BAR_TAB, barTabState(lit), !lit && tabMenu.openId === c.id && "bg-bar-ink/10")}
					>
						<span aria-hidden className="size-2.5 shrink-0" style={{ background: spaceColorVar(c.color) }} />
						{/* Capped: a tab shrinks by its full width, so one long name
						    would squeeze the others to a letter. */}
						<span title={c.name} className="max-w-[240px] truncate">
							{c.name}
						</span>
						{tag && (
							<span data-testid={`space-work-${c.id}`} title="Files the teacher still has to read" className="shrink-0 bg-highlight px-1.5 text-sm text-ink">
								{tag}
							</span>
						)}
					</Link>
				);
			})}
			<ClosedSpacesMenu lit={selected === "closed"} onAdd={() => setDialog(CREATE)} onDelete={onDelete} />
			{menuSpace && (
				<SpaceMenu
					key={menuSpace.id}
					space={menuSpace}
					open={tabMenu.openId === menuSpace.id}
					anchorRef={tabMenu.anchorRef}
					onScreen={selected === menuSpace.id}
					onClose={tabMenu.close}
					onDelete={onDelete}
				/>
			)}
			<SpaceDialog mode={dialog} onClose={() => setDialog(null)} />
		</nav>
	);
}
