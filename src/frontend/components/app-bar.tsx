/**
 * THE TOP BAR, one for the whole window. From the left it holds the
 * wordmark, Today, a tab per open space and the + (add a space, reopen a
 * closed one), the live pill (what is happening now; a click opens its
 * card), the page's own words (bar-slots.tsx), Menu and the clock.
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
import { clockText, selectedTab } from "@/frontend/components/top-bar/top-bar-model";

export function AppBar() {
	const { pathname } = useLocation();
	const { spaces, active } = useSpaces();
	const selected = selectedTab(pathname, active, spaces);
	const { actionsRef } = useBarHosts();
	return (
		<header data-testid="app-bar" className="lh-app-bar lh-drag lh-lights-gutter lh-wco-gutter flex h-(--lh-bar-h) shrink-0 select-none items-stretch bg-bar text-bar-ink">
			{/* Below 760px the wordmark and the clock give their room to Today and the pill; below 1200
			    too while a page has words in the bar (.lh-bar-spare in globals.css). */}
			<span className="lh-bar-spare flex shrink-0 items-center pr-4 pl-5 text-[17px] font-medium max-[760px]:hidden">godspeed</span>
			<SpaceTabs selected={selected} />
			<LivePill />
			{/* After the pill, so its changing words never move the page's. */}
			<div ref={actionsRef} data-testid="bar-actions" className="lh-bar-actions flex shrink-0 items-stretch" />
			<AppMenu lit={selected === "menu"} />
			<Clock />
		</header>
	);
}

function Clock() {
	const minute = useMinute();
	return (
		<span data-testid="bar-clock" className="lh-bar-spare font-count flex shrink-0 items-center pr-5 pl-3 text-[15px] tabular-nums max-[760px]:hidden">
			{minute === null ? "" : clockText(new Date(minute))}
		</span>
	);
}
