import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router";
import { useSpaceSheets } from "@/frontend/components/cheat-sheet/use-cheat-sheet";
import { spaceColorVar } from "@/frontend/components/space-color";
import { useSpaces } from "@/frontend/components/space-context";
import { SpaceDialog } from "@/frontend/components/space-dialog";
import { useMinute } from "@/frontend/components/countdown";
import { isOverdue } from "@/frontend/components/deadlines-model";
import { useUnseenFiles } from "@/frontend/components/files/files-seen";
import { useLessonList } from "@/frontend/components/lessons/use-lesson-list";
import { useOpenDeadlines } from "@/frontend/components/use-open-deadlines";
import { cn } from "@/frontend/lib/utils";
import { longDay } from "@/frontend/components/home-page/home-page-model";
import { spaceTabs, sheetCount, type TabCounts } from "./space-head-model";

/**
 * The head of every space page: the space's color bar, name and
 * description, a tab's own aside, "Edit space", then the tabs with their
 * counts. A prep shows its day beside its name and has its own tabs. With
 * no space picked it names the lessons that belong to none.
 */
export function SpaceHead() {
	const { pathname } = useLocation();
	const { active, activeSpace } = useSpaces();
	const [editing, setEditing] = useState(false);
	const unseenFiles = useUnseenFiles(active, activeSpace?.lastFoundAt, pathname === "/space/files");
	const counts = useTabCounts();
	// The dialog compares its mode by identity: one object per open.
	const editMode = useMemo(() => (editing && active ? { kind: "edit" as const, spaceId: active } : null), [editing, active]);
	return (
		<div data-testid="space-head" className="mx-auto w-full max-w-[908px] shrink-0 px-6 pt-10">
			<div className="flex items-center gap-4">
				{activeSpace && <span aria-hidden className="h-14 w-3 shrink-0" style={{ background: spaceColorVar(activeSpace.color) }} />}
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<p data-testid="space-head-name" title={activeSpace?.name} className="truncate text-[38px] leading-[1.2] text-ink">
						{activeSpace?.name ?? "Lessons with no space"}
					</p>
					{activeSpace?.description && <p className="truncate text-lg text-ink-2">{activeSpace.description}</p>}
				</div>
				{activeSpace?.prep?.date && (
					<p data-testid="prep-head-date" className="shrink-0 bg-highlight px-2.5 py-1 font-count text-[17px] text-ink">
						{longDay(activeSpace.prep.date)}
					</p>
				)}
				<div id={ASIDE_ID} className="shrink-0 empty:hidden" />
				{activeSpace && (
					<button type="button" data-testid="space-edit" onClick={() => setEditing(true)} className="lh-btn lh-btn-quiet shrink-0 text-[15px]">
						{activeSpace.prep ? "Edit prep" : "Edit space"}
					</button>
				)}
			</div>
			{/* The row's rule is a shadow: a scrolling row clips a tab that overhangs it. */}
			<nav aria-label={activeSpace?.name ?? "Lessons with no space"} className="mt-[22px] flex gap-1.5 overflow-x-auto shadow-[inset_0_-2px_0_var(--border)]">
				{spaceTabs(activeSpace?.prep ? "prep" : activeSpace ? "space" : "none").map((t) => {
					const selected = t.href === pathname;
					const count = t.count && counts[t.count];
					return (
						<Link
							key={t.href}
							to={t.href}
							data-testid={t.testid}
							aria-current={selected ? "page" : undefined}
							className={cn(
								"lh-press flex shrink-0 items-baseline gap-[7px] border-b-2 px-3.5 py-2.5 text-lg whitespace-nowrap",
								selected ? "border-ink text-ink" : "border-transparent text-ink-2 hover:text-ink",
							)}
						>
							{t.label}
							{count !== undefined && (
								<span data-testid={`${t.testid}-count`} className="font-count text-[15px] text-ink-2 tabular-nums">
									{count}
								</span>
							)}
							{t.href === "/space/files" && unseenFiles && (
								<span data-testid="nav-files-new" className="bg-highlight px-1.5 text-sm text-ink">
									new
								</span>
							)}
						</Link>
					);
				})}
			</nav>
			<SpaceDialog mode={editMode} onClose={() => setEditing(false)} />
		</div>
	);
}

const ASIDE_ID = "space-head-aside";

/** Puts a tab's own piece in the space head, left of "Edit space" (the
 *  Progress tab's signature). */
export function SpaceHeadAside({ children }: { children: ReactNode }) {
	const [slot, setSlot] = useState<HTMLElement | null>(null);
	useEffect(() => setSlot(document.getElementById(ASIDE_ID)), []);
	return slot && createPortal(children, slot);
}

/** The count beside each tab; undefined until its list has loaded. */
function useTabCounts(): TabCounts {
	const { active, activeSpace } = useSpaces();
	const { chats } = useLessonList();
	const sheets = useSpaceSheets(active).view;
	const open = useOpenDeadlines().deadlines;
	const nowMs = useMinute();
	return {
		lessons: chats?.filter((c) => (c.spaceId ?? null) === active).length,
		files: activeSpace?.fileCount,
		sheets: sheets ? sheetCount(sheets.cards) : undefined,
		deadlines: open && nowMs !== null ? open.filter((d) => d.spaceId === active && !isOverdue(d, nowMs)).length : undefined,
	};
}
