import { useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useLitMarker } from "@/frontend/components/lit-marker";
import { useSpaces } from "@/frontend/components/space-context";
import { spaceColorVar } from "@/frontend/components/space-color";
import { SpaceDialog, type SpaceDialogMode } from "@/frontend/components/space-dialog";
import { STRIP, useTabStrip, wheelSideways } from "@/frontend/components/tab-strip";
import { tabWorkTag } from "@/frontend/components/work/work-model";
import { cn } from "@/frontend/lib/utils";
import { BAR_TAB, barTabState } from "./bar-look";
import { useBarHosts } from "./bar-slots";
import { ClosedSpacesMenu } from "./closed-spaces-menu";

/** Squeezed, a tab still shows about this many letters of its name (the
 *  last room goes to the ellipsis); past that the tabs scroll. */
const TAB_NAME_LETTERS = 8;

// The dialog compares its mode by identity: one object for every open.
const CREATE = { kind: "create" } as const;

/**
 * Home, then one tab per open space, then the + (add a space, reopen a
 * closed one, the lessons with no space). A space's tab switches the window to it and opens its
 * Progress page. It carries a tag while the
 * teacher still has files of it to read. The lit tab, or the lit +, is
 * followed by the page's crumb (bar-slots.tsx) on the same paper: one
 * block that slides to whatever is lit ([data-lit]).
 */
export function SpaceTabs({ selected }: { selected: string }) {
	const { spaces, setActive } = useSpaces();
	const [dialog, setDialog] = useState<SpaceDialogMode | null>(null);
	const openSpaces = spaces.filter((s) => !s.closed);
	const strip = useTabStrip("[data-lit]", `${selected} ${openSpaces.length}`);
	const navRef = useRef<HTMLElement>(null);
	// After the strip has brought the lit tab into sight. A page change slides it too, as the crumb comes or goes.
	const { pathname } = useLocation();
	const paper = useLitMarker(navRef, "[data-lit]", `${selected} ${pathname}`);
	const { crumbRef } = useBarHosts();
	const crumb = <span ref={crumbRef} data-testid="bar-crumb" className="flex shrink-[9999] items-center gap-4 pr-4 text-[15px] font-medium whitespace-nowrap text-ink empty:hidden" />;
	return (
		// Starts squeezed (every unlit name at its few letters) and grows to full
		// names with the room the bar's chips leave; below squeezed, the tabs scroll.
		<nav ref={navRef} aria-label="Spaces" data-testid="space-tabs" className="relative isolate mr-auto flex max-w-max min-w-0 grow basis-[min-content] items-stretch">
			<div ref={paper} hidden aria-hidden className="lh-lit-marker bg-background" />
			<Link to="/" data-testid="nav-home" aria-current={selected === "today" ? "page" : undefined} data-lit={selected === "today" ? "" : undefined} className={cn(BAR_TAB, "shrink-0", barTabState(selected === "today"))}>
				Home
			</Link>
			{/* Too many tabs to fit even squeezed: they scroll, fading out at a cut edge; Home and the + stay put. */}
			<div
				ref={strip.ref}
				data-testid="space-tabs-strip"
				onScroll={strip.measure}
				onWheel={wheelSideways}
				className={cn("lh-tab-strip flex shrink-[9999] items-stretch", STRIP)}
			>
				{openSpaces.map((c) => {
					const tag = tabWorkTag(c);
					const lit = selected === c.id;
					// One wrapper either way, so lighting a tab never remounts its link (and its focus).
					return (
						<div key={c.id} data-lit={lit ? "" : undefined} className={lit ? "flex max-w-full shrink-0 items-stretch" : "contents"}>
							<Link
								to="/space"
								data-testid={`space-option-${c.id}`}
								data-teacher-target={`space:${c.id}`}
								aria-current={lit ? "page" : undefined}
								onClick={() => setActive(c.id)}
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
			<div data-lit={selected === "plus" ? "" : undefined} className={selected === "plus" ? "flex items-stretch" : "contents"}>
				<ClosedSpacesMenu lit={selected === "plus"} onAdd={() => setDialog(CREATE)} />
				{selected === "plus" && crumb}
			</div>
			<SpaceDialog mode={dialog} onClose={() => setDialog(null)} />
		</nav>
	);
}
