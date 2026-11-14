/**
 * The teacher's panel: click the teacher in the top bar.
 * Docked to the window's right edge, under the top bar. It pushes the page
 * left to make room. Never open over a lesson (the lesson has its own
 * teacher column). The head (the name and Close; the status stays on the
 * top bar's chip right above), then two
 * tabs: Talk (a chat outside lessons, talk-view.tsx, with Clear chat on
 * the tab row) and Activity (teacher-activity.tsx).
 */
import { useEffect, useId, useState } from "react";
import { cn } from "@/frontend/lib/utils";
import type { AgentAction } from "@/shared/core";
import type { AgentStatus } from "@/frontend/components/agent-status";
import { tabListKeys } from "@/frontend/components/ui/tab-list";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { TalkView, type TalkAsk } from "./talk-view";
import { TeacherActivity } from "./teacher-activity";
import { DOCK_WIDTH, dockPush, dockWidth } from "./dock-model";

const TABS = ["talk", "activity"] as const;
type Tab = (typeof TABS)[number];

/** The page's push while the panel is open (main's padding reads it). */
const PUSH_VAR = "--lh-dock-push";

export function TeacherPanel({
	name,
	agent,
	startTab = "talk",
	onClose,
	recent,
	onPick,
	ask,
	onAsked,
}: {
	name: string;
	agent: AgentStatus | null;
	/** The tab it opens on, and switches to when this changes. */
	startTab?: Tab;
	onClose: () => void;
	recent: readonly AgentAction[];
	onPick: (action: AgentAction) => void;
	/** A message to send in Talk (askTeacher); the panel switches to Talk. */
	ask?: TalkAsk | null;
	onAsked?: (id: number) => void;
}) {
	const [tab, setTab] = useState<Tab>(startTab);
	useEffect(() => setTab(startTab), [startTab]);
	const [clearSlot, setClearSlot] = useState<HTMLElement | null>(null);
	const tabsId = useId();
	const [width, setWidth] = useState(DOCK_WIDTH);
	useEffect(() => {
		const root = document.documentElement;
		const measure = () => {
			setWidth(dockWidth(window.innerWidth));
			const page = document.querySelector("main")?.getBoundingClientRect().width ?? window.innerWidth;
			root.style.setProperty(PUSH_VAR, `${dockPush(window.innerWidth, page)}px`);
		};
		measure();
		window.addEventListener("resize", measure);
		return () => {
			window.removeEventListener("resize", measure);
			root.style.removeProperty(PUSH_VAR);
		};
	}, []);
	useEffect(() => {
		if (ask) setTab("talk");
	}, [ask]);

	return (
		<section
			data-teacher-panel=""
			data-testid="teacher-panel"
			aria-label={name}
			style={{ width }}
			className="lh-slide-in fixed top-12 right-0 bottom-0 z-[41] flex max-w-full flex-col border-l-2 border-line bg-panel font-ui"
		>
			<div className="flex shrink-0 items-center gap-3 pt-4 pr-3.5 pb-3 pl-5">
				<span data-testid="teacher-panel-name" className="min-w-0 flex-1 truncate text-xl leading-snug font-medium text-ink">
					{name}
				</span>
				<button type="button" data-testid="teacher-panel-close" onClick={onClose} className="lh-btn lh-btn-quiet shrink-0 text-[15px]">
					<PixelIcon name="close" />
					Close
				</button>
			</div>

			<div className="flex shrink-0 items-center border-b border-tone-2 px-3.5">
				<div
					role="tablist"
					aria-label={name}
					onKeyDown={tabListKeys(TABS.indexOf(tab), TABS.length, (i) => setTab(TABS[i]!))}
					className="flex gap-1.5"
				>
					{TABS.map((t) => (
						<button
							key={t}
							type="button"
							role="tab"
							id={`${tabsId}-${t}`}
							aria-selected={tab === t}
							aria-controls={`${tabsId}-panel`}
							tabIndex={tab === t ? 0 : -1}
							data-testid={`teacher-tab-${t}`}
							onClick={() => setTab(t)}
							className={cn(
								"lh-press -mb-px border-b-2 px-3.5 py-2.5 text-lg",
								tab === t ? "border-ink font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink",
							)}
						>
							{t === "talk" ? "Talk" : "Activity"}
						</button>
					))}
				</div>
				{tab === "talk" && <span ref={setClearSlot} className="ml-auto" />}
			</div>

			{tab === "talk" ? (
				<div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-talk`} className="flex min-h-0 flex-1 flex-col">
					<TalkView name={name} agent={agent} recent={recent} onPick={onPick} ask={ask ?? null} onAsked={onAsked} clearSlot={clearSlot} />
				</div>
			) : (
				<div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-activity`} className="flex min-h-0 flex-1 flex-col px-5 py-[18px]">
					<TeacherActivity />
				</div>
			)}
		</section>
	);
}
