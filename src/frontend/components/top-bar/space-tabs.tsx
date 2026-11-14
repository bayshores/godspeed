import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useSpaces } from "@/frontend/components/space-context";
import { spaceColorVar } from "@/frontend/components/space-color";
import { SpaceDialog, type SpaceDialogMode } from "@/frontend/components/space-dialog";
import { tabWorkTag } from "@/frontend/components/work/work-model";
import { cn } from "@/frontend/lib/utils";
import { BAR_TAB, barTabState } from "./bar-look";
import { ClosedSpacesMenu } from "./closed-spaces-menu";
import { SpaceMenu, useSpaceMenu } from "./space-menu";
import { spaceMenuDescription } from "./top-bar-model";

// The dialog compares its mode by identity: one object for every open.
const CREATE = { kind: "create" } as const;

/** The tab strip's scroller: whether tabs are cut off at its end, and the
 *  lit tab kept in sight as the window narrows or another tab lights. */
function useTabStrip(selected: string, tabs: number) {
	const ref = useRef<HTMLDivElement>(null);
	const [cut, setCut] = useState(false);
	const measure = useCallback(() => {
		const el = ref.current;
		if (el) setCut(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
	}, []);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const reveal = () => {
			el.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
			measure();
		};
		reveal();
		const observer = new ResizeObserver(reveal);
		observer.observe(el);
		for (const tab of el.children) observer.observe(tab);
		return () => observer.disconnect();
	}, [selected, tabs, measure]);
	return { ref, cut, measure };
}

/**
 * Today, then one tab per open space, then the + (add a space, reopen a
 * closed one, the lessons with no space). A space's tab switches the window to it and opens its
 * Progress page; a right-click opens its menu. It carries a tag while the
 * teacher still has files of it to read.
 */
export function SpaceTabs({ selected }: { selected: string }) {
	const { spaces, setActive } = useSpaces();
	const tabMenu = useSpaceMenu();
	const [dialog, setDialog] = useState<SpaceDialogMode | null>(null);
	// After the menu's Close its tab is gone: focus goes to the lit tab.
	const [refocus, setRefocus] = useState(false);
	const onDelete = (spaceId: string) => {
		setDialog({ kind: "delete", spaceId });
		setRefocus(false); // the dialog takes focus
	};
	const openSpaces = spaces.filter((s) => !s.closed);
	const strip = useTabStrip(selected, openSpaces.length);
	const menuSpace = openSpaces.find((s) => s.id === tabMenu.shownId);
	const navRef = useRef<HTMLElement>(null);
	useEffect(() => {
		if (!refocus) return;
		setRefocus(false);
		const nav = navRef.current;
		const lit = nav?.querySelector<HTMLElement>(selected === "plus" ? '[aria-haspopup="menu"]' : '[aria-current="page"]');
		(lit ?? nav?.querySelector<HTMLElement>("a"))?.focus();
	}, [refocus, selected]);
	return (
		<nav ref={navRef} aria-label="Spaces" data-testid="space-tabs" className="flex min-w-0 flex-1 items-stretch">
			{/* Too many tabs to fit even squeezed: they scroll, fading out at the edge, and the + stays beside them. */}
			<div
				ref={strip.ref}
				data-testid="space-tabs-strip"
				onScroll={strip.measure}
				onWheel={(e) => {
					// A mouse wheel only scrolls up and down.
					if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
				}}
				className={cn(
					"flex min-w-0 items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
					strip.cut && "[mask-image:linear-gradient(to_right,black_calc(100%-32px),transparent)]",
				)}
			>
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
							aria-description={spaceMenuDescription(false)}
							onClick={() => {
								tabMenu.close();
								setActive(c.id);
							}}
							onContextMenu={(e) => tabMenu.onContextMenu(e, c.id)}
							onKeyDown={(e) => tabMenu.onKeyDown(e, c.id)}
							className={cn(
								BAR_TAB,
								// The name gives way first; the dot and the tag keep their room.
								"min-w-auto grid",
								tag ? "grid-cols-[auto_minmax(0,max-content)_auto]" : "grid-cols-[auto_minmax(0,max-content)]",
								barTabState(lit),
								!lit && tabMenu.openId === c.id && "bg-bar-ink/10",
							)}
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
			</div>
			<ClosedSpacesMenu lit={selected === "plus"} onAdd={() => setDialog(CREATE)} onDelete={onDelete} />
			{menuSpace && (
				<SpaceMenu
					key={menuSpace.id}
					space={menuSpace}
					open={tabMenu.openId === menuSpace.id}
					anchorRef={tabMenu.anchorRef}
					onScreen={selected === menuSpace.id}
					onClose={() => {
						tabMenu.close();
						setRefocus(true);
					}}
					onDelete={onDelete}
				/>
			)}
			<SpaceDialog mode={dialog} onClose={() => setDialog(null)} />
		</nav>
	);
}
