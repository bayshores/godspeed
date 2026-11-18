import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useSpaces } from "@/frontend/components/space-context";
import { spaceColorVar } from "@/frontend/components/space-color";
import { SpaceDialog, type SpaceDialogMode } from "@/frontend/components/space-dialog";
import { tabWorkTag } from "@/frontend/components/work/work-model";
import { cn } from "@/frontend/lib/utils";
import { BAR_TAB, barTabState } from "./bar-look";
import { useBarHosts } from "./bar-slots";
import { ClosedSpacesMenu } from "./closed-spaces-menu";
import { SpaceMenu, useSpaceMenu } from "./space-menu";
import { spaceMenuDescription } from "./top-bar-model";

/** Squeezed, a tab still shows about this many letters of its name (the
 *  last room goes to the ellipsis); past that the tabs scroll. */
const TAB_NAME_LETTERS = 8;

/** How wide (px) the strip fades out where it cuts tabs off (as in its classes). */
const FADE = 24;

// The dialog compares its mode by identity: one object for every open.
const CREATE = { kind: "create" } as const;

/** The tab strip's scroller: which of its ends cut tabs off, and the lit
 *  tab (with the page's crumb) kept in sight as the window narrows or another tab lights. */
function useTabStrip(selected: string, tabs: number) {
	const ref = useRef<HTMLDivElement>(null);
	const [cut, setCut] = useState({ start: false, end: false });
	const measure = useCallback(() => {
		const el = ref.current;
		if (!el) return;
		const start = el.scrollLeft > 1;
		const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
		setCut((c) => (c.start === start && c.end === end ? c : { start, end }));
	}, []);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const reveal = () => {
			const lit = el.querySelector<HTMLElement>("[data-lit]");
			// Too narrow to keep the lit tab clear of both fades: centered, they fall on its padding.
			const center = !!lit && lit.offsetWidth + 2 * FADE > el.clientWidth;
			lit?.scrollIntoView?.({ block: "nearest", inline: center ? "center" : "nearest" });
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
 * teacher still has files of it to read. The lit tab, or the lit +, is
 * followed by the page's crumb (bar-slots.tsx) on the same paper.
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
	const { crumbRef } = useBarHosts();
	const crumb = <span ref={crumbRef} data-testid="bar-crumb" className="flex shrink-[9999] items-center gap-4 bg-background pr-4 text-[15px] font-medium whitespace-nowrap text-ink empty:hidden" />;
	useEffect(() => {
		if (!refocus) return;
		setRefocus(false);
		const nav = navRef.current;
		const lit = nav?.querySelector<HTMLElement>(selected === "plus" ? '[aria-haspopup="menu"]' : '[aria-current="page"]');
		(lit ?? nav?.querySelector<HTMLElement>("a"))?.focus();
	}, [refocus, selected]);
	return (
		// Starts squeezed (every unlit name at its few letters) and grows to full
		// names with the room the bar's chips leave; below squeezed, the tabs scroll.
		<nav ref={navRef} aria-label="Spaces" data-testid="space-tabs" className="mr-auto flex max-w-max min-w-0 grow basis-[min-content] items-stretch">
			<Link to="/" data-testid="nav-today" aria-current={selected === "today" ? "page" : undefined} className={cn(BAR_TAB, "shrink-0", barTabState(selected === "today"))}>
				Today
			</Link>
			{/* Too many tabs to fit even squeezed: they scroll, fading out at a cut edge; Today and the + stay put. */}
			<div
				ref={strip.ref}
				data-testid="space-tabs-strip"
				onScroll={strip.measure}
				onWheel={(e) => {
					// A mouse wheel only scrolls up and down.
					if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
				}}
				className={cn(
					"flex min-w-0 shrink-[9999] scroll-px-6 items-stretch overflow-x-auto [scrollbar-width:none]! [&::-webkit-scrollbar]:hidden",
					strip.cut.end && !strip.cut.start && "[mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)]",
					strip.cut.start && !strip.cut.end && "[mask-image:linear-gradient(to_left,black_calc(100%-24px),transparent)]",
					strip.cut.start && strip.cut.end && "[mask-image:linear-gradient(to_right,transparent,black_24px,black_calc(100%-24px),transparent)]",
				)}
			>
				{openSpaces.map((c) => {
					const tag = tabWorkTag(c);
					const lit = selected === c.id;
					// One wrapper either way, so lighting a tab never remounts its link (and its focus).
					return (
						<div key={c.id} data-lit={lit ? "" : undefined} className={lit ? cn("flex shrink-0 items-stretch", strip.cut.start || strip.cut.end ? "max-w-[calc(100%-16px)]" : "max-w-full") : "contents"}>
							<Link
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
									// An unlit tab's name gives way first, down to a few letters; the dot and the tag keep their
									// room. The lit tab and the page's crumb after it never give way to the other tabs.
									"min-w-auto grid",
									// Its wrapper is never wider than the strip, and while the strip cuts tabs off, the strip less the
									// fades' overhang past its padding (2 × (24 − 16) px): centered, its dot and name are clear of both
									// fades and a long name ends in "…". In a strip that narrow the crumb's name gives way first,
									// then the tab's name, down to the dot.
									lit ? "grid-cols-[auto_fit-content(240px)_auto]" : "grid-cols-[auto_minmax(auto,max-content)_auto]",
									barTabState(lit),
									!lit && tabMenu.openId === c.id && "bg-bar-ink/10",
								)}
							>
								<span aria-hidden className="size-2.5 shrink-0" style={{ background: spaceColorVar(c.color) }} />
								{/* Capped: a tab shrinks by its full width, so one long name
								    would squeeze the others to a letter. */}
								<span title={c.name} style={lit ? undefined : { minWidth: c.name.length > TAB_NAME_LETTERS ? `${TAB_NAME_LETTERS}ch` : "max-content" }} className="max-w-[240px] truncate">
									{c.name}
								</span>
								{tag && (
									<span data-testid={`space-work-${c.id}`} title="Files the teacher still has to read" className="shrink-0 bg-highlight px-1.5 text-sm text-ink">
										{tag}
									</span>
								)}
							</Link>
							{lit && crumb}
						</div>
					);
				})}
			</div>
			{/* Outside the strip, the + and its crumb never scroll away; the crumb gives way after the tabs. */}
			<div className={selected === "plus" ? "flex items-stretch" : "contents"}>
				<ClosedSpacesMenu lit={selected === "plus"} onAdd={() => setDialog(CREATE)} onDelete={onDelete} />
				{selected === "plus" && crumb}
			</div>
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
