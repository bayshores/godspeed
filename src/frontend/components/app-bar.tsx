/**
 * THE TOP BAR, one for the whole window: the wordmark, Today, a tab per
 * open space and the + (add a space, reopen a closed one), then Follow, the teacher (a click opens its panel), Menu and the
 * clock. A page that draws a bar of its own (.lh-own-bar) hides this one
 * (globals.css). In the desktop app the bar is the window's drag band, with the
 * traffic lights in its left gutter; clickable elements carve out of the
 * drag region on their own (crates/shell/src/shim.js).
 */

import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { useActivity } from "@/frontend/components/activity-dock";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { useSpaces } from "@/frontend/components/space-context";
import { useMinute } from "@/frontend/components/countdown";
import { announceDelay } from "@/frontend/components/teacher/follow-status";
import { useTeacher } from "@/frontend/components/teacher/teacher-provider";
import { AppMenu } from "@/frontend/components/top-bar/app-menu";
import { BAR_TAB, barTabState } from "@/frontend/components/top-bar/bar-look";
import { SpaceTabs } from "@/frontend/components/top-bar/space-tabs";
import { FollowButton } from "@/frontend/components/top-bar/follow-button";
import { chipText, clockText, selectedTab } from "@/frontend/components/top-bar/top-bar-model";
import { useWorker } from "@/frontend/components/work/use-worker";
import { workChip } from "@/frontend/components/work/work-model";
import { cn } from "@/frontend/lib/utils";

export function AppBar() {
	const { pathname } = useLocation();
	const { spaces, active } = useSpaces();
	const selected = selectedTab(pathname, active, spaces);
	return (
		<header data-testid="app-bar" className="lh-app-bar lh-drag lh-lights-gutter lh-wco-gutter flex h-12 shrink-0 select-none items-stretch bg-bar text-bar-ink">
			<span className="flex shrink-0 items-center pr-4 pl-5 text-[17px] font-medium">godspeed</span>
			<SpaceTabs selected={selected} />
			<FollowButton />
			<WorkChip />
			<TeacherChip />
			<AppMenu lit={selected === "menu"} />
			<Clock />
		</header>
	);
}

/** A chip gets the room the tabs leave (never more than its text), so it
 *  gives way before any tab name does. */
const CHIP_FIT = "min-w-auto max-w-max shrink-0 grow basis-0";

/** A chip's text on one line, cut short with an ellipsis but never below its first word. */
function ChipText({ text, widest }: { text: string; widest: string }) {
	const first = /^[^\s,]+/.exec(text)?.[0] ?? text;
	return (
		<span className={cn("grid", widest)}>
			{/* Sizing only: at least the first word wide, at most the whole text. */}
			<span aria-hidden className="invisible [grid-area:1/1]">
				{first}…
			</span>
			<span aria-hidden className="invisible h-0 overflow-hidden break-all whitespace-normal [grid-area:1/1]">
				{text}
			</span>
			<span className="w-0 min-w-full truncate [grid-area:1/1]">{text}</span>
		</span>
	);
}

/** While background work runs: who does it and how far it is, on the
 *  highlighter. A click opens the teacher's panel on its Activity list. */
function WorkChip() {
	const teacher = useTeacher();
	const { spaces } = useSpaces();
	const { feed } = useActivity();
	const { worker } = useWorker();
	const text = workChip({ worker, spaces, jobs: feed.jobs.length + feed.extractions.length });
	if (!teacher || !text) return null;
	return (
		<button type="button" data-testid="bar-work" title={text} onClick={() => teacher.showActivity()} className={cn("lh-press my-2 ml-1 flex items-center bg-highlight px-3 text-[15px] whitespace-nowrap text-ink", CHIP_FIT)}>
			<ChipText text={text} widest="max-w-[256px]" />
		</button>
	);
}

/** The teacher's name with what it is doing; a click opens its panel. */
function TeacherChip() {
	const teacher = useTeacher();
	const agent = useAgentStatus();
	if (!teacher) return null;
	const text = chipText({ name: teacher.name, doing: teacher.doing, agent });
	return (
		<>
			<button
				type="button"
				data-testid="bar-teacher"
				data-teacher-panel-toggle=""
				aria-expanded={teacher.panelOpen}
				onClick={() => teacher.setPanelOpen(!teacher.panelOpen)}
				title={text}
				className={cn(BAR_TAB, "ml-1", CHIP_FIT, barTabState(teacher.panelOpen))}
			>
				<ChipText text={text} widest="max-w-[308px]" />
			</button>
			{teacher.doing && <Announce text={text} />}
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
