"use client";

/**
 * THE TOP BAR, one for the whole window: the wordmark, Today, a tab per
 * class, then Follow, the teacher (a click opens its panel), Menu and the
 * clock. A page that draws a bar of its own (.lh-own-bar) hides this one
 * (globals.css). In Electron the bar is the window's drag band, with the traffic
 * lights in its left gutter; clickable elements carve out of the drag
 * region on their own (globals.css).
 */

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useActivity } from "@/frontend/components/activity-dock";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { useClasses } from "@/frontend/components/class-context";
import { useMinute } from "@/frontend/components/countdown";
import { announceDelay } from "@/frontend/components/halley/follow-status";
import { useHalley } from "@/frontend/components/halley/halley-provider";
import { AppMenu } from "@/frontend/components/top-bar/app-menu";
import { BAR_TAB, barTabState, ClassTabs } from "@/frontend/components/top-bar/class-tabs";
import { FollowButton } from "@/frontend/components/top-bar/follow-button";
import { chipText, clockText, selectedTab } from "@/frontend/components/top-bar/top-bar-model";
import { cn } from "@/frontend/lib/utils";

export function AppBar() {
	const pathname = usePathname();
	const { classes, active } = useClasses();
	const tabIds = classes.filter((c) => !c.archived).map((c) => c.id);
	const selected = selectedTab(pathname, active, tabIds);
	return (
		<header data-testid="app-bar" className="lh-app-bar lh-drag lh-lights-gutter lh-wco-gutter flex h-12 shrink-0 select-none items-stretch bg-bar text-bar-ink">
			<span className="flex shrink-0 items-center pr-4 pl-5 text-[17px] font-medium">godspeed</span>
			<ClassTabs selected={selected} />
			<FollowButton />
			<TeacherChip />
			<AppMenu lit={selected === "menu"} />
			<Clock />
		</header>
	);
}

/** The teacher's name with what it is doing; a click opens its panel. */
function TeacherChip() {
	const halley = useHalley();
	const agent = useAgentStatus();
	const { feed } = useActivity();
	if (!halley) return null;
	const text = chipText({ name: halley.name, doing: halley.doing, agent, jobs: feed.jobs.length + feed.extractions.length });
	return (
		<>
			<button
				type="button"
				data-testid="bar-teacher"
				data-halley-panel-toggle=""
				aria-expanded={halley.panelOpen}
				onClick={() => halley.setPanelOpen(!halley.panelOpen)}
				className={cn(BAR_TAB, "ml-1 max-w-[340px] shrink", barTabState(halley.panelOpen))}
			>
				<span className="truncate">{text}</span>
			</button>
			{halley.doing && <Announce text={text} />}
		</>
	);
}

/** What a screen reader hears: the newest line, at most every few seconds
 *  (a file read in parts would otherwise speak every part). */
function Announce({ text }: { text: string }) {
	const [said, setSaid] = useState(text);
	const lastAt = useRef<number | null>(null);
	useEffect(() => {
		if (text === said) return;
		const t = setTimeout(() => {
			lastAt.current = Date.now();
			setSaid(text);
		}, announceDelay(lastAt.current, Date.now()));
		return () => clearTimeout(t);
	}, [text, said]);
	return (
		<span aria-live="polite" className="sr-only">
			{said}
		</span>
	);
}

function Clock() {
	const minute = useMinute();
	return (
		<span data-testid="bar-clock" className="font-count flex shrink-0 items-center pr-5 pl-3 text-[15px] tabular-nums">
			{minute === null ? "" : clockText(new Date(minute))}
		</span>
	);
}
