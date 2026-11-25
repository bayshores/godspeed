/**
 * The teacher's panel, opened and closed from the strip only: it stays
 * while the learner works on the page, a lesson too. It runs from the
 * top bar to the window's bottom, left of the strip, pushing the page
 * left to make room and covering it where there is none; the learner
 * drags its left edge. One head row (panel-head.tsx), then its chat
 * (talk-chat.tsx), or Activity (teacher-activity.tsx) while the chat is in
 * a window of its own.
 */
import { useEffect, useLayoutEffect, useState } from "react";
import { useLocation } from "react-router";
import { cn } from "@/frontend/lib/utils";
import type { TalkChat } from "@/shared/core";
import { BarWindow, observeBar } from "@/frontend/components/ui/bar-window";
import { ResizeHandle, usePaneWidth } from "@/frontend/components/ui/resize-handle";
import type { AgentStatus } from "@/frontend/components/agent-status";
import { screenStatusLine, teacherTerminalState, type TerminalFacts } from "@/frontend/components/terminal/terminal-model";
import { stripWidth } from "@/frontend/components/strip/strip-dom";
import { useTeacher } from "./teacher-context";
import type { AgentDoing } from "./follow-status";
import { TeacherActivity } from "./teacher-activity";
import { PanelHead } from "./panel-head";
import { boxPage } from "./starter-model";
import { TalkChatView } from "./talk-chat";
import { PANEL_WIDTH, panelLayout, type PanelView } from "./dock-model";

/** The status line under the name: what the agent is doing while it works,
 *  else "on" while an agent in its terminal is connected, else ready.
 *  Nothing until the first read of the agent. */
export function agentLine(agent: AgentStatus | null, teacher: string, doing: AgentDoing | null = null): string | null {
	if (!agent) return null;
	if (doing?.working) return doing.text;
	return agent.connected ? `${teacher} is on` : "Ready";
}

/**
 * What the teacher's own head says: its screen's line while its terminal
 * starts or needs the learner (lit while it needs them), else the status
 * line, with the square breathing while that line is the work it does.
 */
export function teacherHead(i: { agent: AgentStatus | null; name: string; doing: AgentDoing | null; facts: TerminalFacts | null }): { status: string | null; lit: boolean; working: boolean } {
	const line = agentLine(i.agent, i.name, i.doing);
	const screen = screenStatusLine(i.facts, i.name);
	return { status: screen ?? line, lit: teacherTerminalState(i.facts) === "needsYou", working: !screen && !!i.doing?.working && line === i.doing.text };
}

/** The page's push while the panel is open (main's padding reads it). */
const PUSH_VAR = "--lh-dock-push";
/** The open panel's width, whether it pushes the page or lies over it (Follow's slip ends at its edge). */
const WIDTH_VAR = "--lh-dock-width";

export function TeacherPanel({
	name,
	view,
	chat,
	asking,
	popOut,
	putBack,
	list,
	onList,
	focus,
	state,
	onBeside,
}: {
	name: string;
	view: PanelView;
	/** The chat shown (null: a new chat), its row in the list, and the pick of another. */
	chat: { id: string | null; row: TalkChat | null; show: (id: string | null) => void };
	/** A line a page key handed the teacher. */
	asking: { line: string; clear: () => void } | null;
	/** Moves the chat to a window of its own; null where there is none (a browser). Resolves to why
	 *  the shell refused, or null. */
	popOut: (() => Promise<string | null>) | null;
	/** Brings the popped chat back. */
	putBack: (() => void) | null;
	list: boolean;
	onList: (open: boolean) => void;
	/** The learner opened the panel: its box takes the keyboard. */
	focus: boolean;
	/** "closed" while it goes back into the strip. */
	state: "open" | "closed";
	/** How much of the page is in view beside the open panel (0 when it takes the whole window), null once it closes. */
	onBeside: (width: number | null) => void;
}) {
	const teacher = useTeacher();
	const { pathname } = useLocation();
	const doing = teacher?.doing ?? null;
	const [wanted, setWanted] = usePaneWidth("teacher", PANEL_WIDTH);
	const [{ width, whole }, setLayout] = useState({ width: wanted, whole: false });
	const [popError, setPopError] = useState<string | null>(null);
	// Before paint, so the chat is never sized to another box first.
	useLayoutEffect(() => {
		const measure = () => {
			// The strip keeps the window's right edge: the panel and the page share what is left of it.
			const room = window.innerWidth - stripWidth();
			const page = (document.querySelector("main")?.getBoundingClientRect().width ?? window.innerWidth) - stripWidth();
			const layout = panelLayout(room, page, wanted);
			setLayout({ width: layout.width, whole: layout.width >= room });
			// On its way out it lets the page back at once.
			const open = state === "open";
			document.documentElement.style.setProperty(PUSH_VAR, `${open ? layout.push : 0}px`);
			document.documentElement.style.setProperty(WIDTH_VAR, `${open ? layout.width : 0}px`);
			onBeside(open ? Math.max(0, room - layout.width) : null);
		};
		measure();
		// After layout, with the window's new size: a one-shot resize (zoom, a snap) can fire the
		// window's resize event before its width changes.
		const observer = new ResizeObserver(measure);
		observer.observe(document.documentElement);
		observeBar(observer);
		return () => observer.disconnect();
	}, [wanted, state, onBeside]);
	useEffect(
		() => () => {
			document.documentElement.style.removeProperty(PUSH_VAR);
			document.documentElement.style.removeProperty(WIDTH_VAR);
		},
		[],
	);
	useEffect(() => () => onBeside(null), [onBeside]);
	const popped = view === "popped";
	return (
		<BarWindow right={stripWidth()} width={width} height={null} state={state} data-teacher-panel="" data-whole={whole || undefined} data-testid="teacher-panel" aria-label={name}>
			{/* Nothing to drag while it takes the whole window. */}
			{!whole && <ResizeHandle paneKey="teacher" width={width} bounds={PANEL_WIDTH} onWidth={setWanted} label={`Resize ${name}'s panel`} />}
			<PanelHead
				name={name}
				working={!!doing?.working || !!chat.row?.running}
				elsewhere={!!doing?.working}
				list={popped ? null : { open: list, onOpen: onList }}
				popOut={!popped && popOut ? () => void popOut().then(setPopError) : null}
				putBack={popped ? putBack : null}
			/>
			{popError && (
				<p role="alert" className="shrink-0 px-[18px] pb-2 text-[15px] text-ans-wrong">
					{popError}
				</p>
			)}
			<div
				data-testid="teacher-panel-body"
				className={cn(
					"flex min-h-0 flex-1 flex-col motion-safe:transition-opacity motion-safe:duration-(--lh-dur) motion-safe:ease-(--lh-ease-out) peer-data-[hang]:opacity-40",
					// The chat reads like the page; Activity alone keeps the panel's own colors.
					!popped && "lh-desk lh-page-colors",
				)}
			>
				{popped ? (
					<div className="flex min-h-0 flex-1 flex-col gap-[18px] px-[18px] pt-1.5 pb-[18px]">
						<TeacherActivity />
					</div>
				) : (
					// SETUP CARD SLOT: while the agent can't run, the setup card takes this place (its
					// thread is kept and glides back once the agent is ready).
					<TalkChatView chatId={chat.id} chat={chat.row} onChat={chat.show} name={name} page={boxPage(pathname)} ask={asking} focus={focus} />
				)}
			</div>
		</BarWindow>
	);
}
