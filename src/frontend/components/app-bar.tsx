/**
 * THE TOP BAR, one for the whole window. From the left it holds the
 * date, Today, a tab per open space and the + (add a space, reopen a
 * closed one), the live pill (what is happening now; a click opens its
 * card), the page's own words (bar-slots.tsx), Menu and the clock. In a
 * window too narrow for one line it is two lines on every page: the
 * date, the page's words and the clock above the rest (globals.css).
 *
 * A page that draws a bar of its own (.lh-own-bar) hides this one, as
 * globals.css says. In the desktop app the bar is the window's drag band,
 * with the traffic lights in its left gutter. Clickable elements carve
 * themselves out of the drag region (crates/shell/src/shim.js).
 */

import { useLocation } from "react-router";
import { useSpaces } from "@/frontend/components/space-context";
import { useMinute } from "@/frontend/components/countdown";
import { AppMenu } from "@/frontend/components/top-bar/app-menu";
import { LivePill } from "@/frontend/components/top-bar/live-pill";
import { SpaceTabs } from "@/frontend/components/top-bar/space-tabs";
import { useBarHosts } from "@/frontend/components/top-bar/bar-slots";
import { clockText, dateText, selectedTab } from "@/frontend/components/top-bar/top-bar-model";

export function AppBar() {
	const { pathname } = useLocation();
	const { spaces, active } = useSpaces();
	const selected = selectedTab(pathname, active, spaces);
	const { actionsRef } = useBarHosts();
	return (
		<header data-testid="app-bar" className="lh-app-bar lh-drag lh-lights-gutter lh-wco-gutter flex h-(--lh-bar-h) shrink-0 select-none items-stretch bg-bar text-bar-ink">
			<SpaceTabs selected={selected} />
			<LivePill />
			{/* The bar's top line in a narrow window; on one line its parts sit in the bar itself (globals.css). */}
			<div className="lh-bar-top">
				<BarDate />
				{/* After the pill, so its changing words never move the page's. */}
				<div ref={actionsRef} data-testid="bar-actions" className="lh-bar-actions flex shrink-0 items-center" />
				<Clock />
			</div>
			<AppMenu lit={selected === "menu"} />
		</header>
	);
}

function BarDate() {
	const minute = useMinute();
	return (
		<span data-testid="bar-date" className="font-count -order-1 flex shrink-0 items-center pr-4 pl-5 text-[15px] tabular-nums max-[1099px]:pl-4">
			{minute === null ? "" : dateText(new Date(minute))}
		</span>
	);
}

function Clock() {
	const minute = useMinute();
	return (
		<span data-testid="bar-clock" className="font-count order-1 flex shrink-0 items-center pr-5 pl-3 text-[15px] tabular-nums max-[1099px]:pr-3">
			{minute === null ? "" : clockText(new Date(minute))}
		</span>
	);
}
