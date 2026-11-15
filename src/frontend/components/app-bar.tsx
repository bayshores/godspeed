/**
 * THE TOP BAR, one for the whole window: the wordmark, Today, a tab per
 * open space and the + (add a space, reopen a closed one), then the live
 * pill (what is happening now; a click opens its card), Menu and the
 * clock. A page that draws a bar of its own (.lh-own-bar) hides this one
 * (globals.css). In the desktop app the bar is the window's drag band, with the
 * traffic lights in its left gutter; clickable elements carve out of the
 * drag region on their own (crates/shell/src/shim.js).
 */

import { useLocation } from "react-router";
import { useSpaces } from "@/frontend/components/space-context";
import { useMinute } from "@/frontend/components/countdown";
import { AppMenu } from "@/frontend/components/top-bar/app-menu";
import { LivePill } from "@/frontend/components/top-bar/live-pill";
import { SpaceTabs } from "@/frontend/components/top-bar/space-tabs";
import { clockText, selectedTab } from "@/frontend/components/top-bar/top-bar-model";

export function AppBar() {
	const { pathname } = useLocation();
	const { spaces, active } = useSpaces();
	const selected = selectedTab(pathname, active, spaces);
	return (
		<header data-testid="app-bar" className="lh-app-bar lh-drag lh-lights-gutter lh-wco-gutter flex h-12 shrink-0 select-none items-stretch bg-bar text-bar-ink">
			{/* Below 760px the wordmark and the clock give their room to Today and the pill. */}
			<span className="flex shrink-0 items-center pr-4 pl-5 text-[17px] font-medium max-[760px]:hidden">godspeed</span>
			<SpaceTabs selected={selected} />
			<LivePill />
			<AppMenu lit={selected === "menu"} />
			<Clock />
		</header>
	);
}

function Clock() {
	const minute = useMinute();
	return (
		<span data-testid="bar-clock" className="font-count flex shrink-0 items-center pr-5 pl-3 text-[15px] tabular-nums max-[760px]:hidden">
			{minute === null ? "" : clockText(new Date(minute))}
		</span>
	);
}
