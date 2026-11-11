"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useClassSheets } from "@/frontend/components/cheat-sheet/use-cheat-sheet";
import { classColorVar } from "@/frontend/components/class-color";
import { useClasses } from "@/frontend/components/class-context";
import { ClassDialog } from "@/frontend/components/class-dialog";
import { useMinute } from "@/frontend/components/countdown";
import { isOverdue } from "@/frontend/components/deadlines-model";
import { useUnseenFiles } from "@/frontend/components/files/files-seen";
import { useLessonList } from "@/frontend/components/lessons/use-lesson-list";
import { useOpenDeadlines } from "@/frontend/components/use-open-deadlines";
import { cn } from "@/frontend/lib/utils";
import { classTabs, sheetCount, type TabCounts } from "./class-head-model";

/**
 * The head of every class page: the class's color bar, name and
 * description, a tab's own aside, "Edit class", then the tabs with their
 * counts. With no class picked it names the lessons that belong to none.
 */
export function ClassHead() {
	const pathname = usePathname();
	const { active, activeClass } = useClasses();
	const [editing, setEditing] = useState(false);
	const unseenFiles = useUnseenFiles(active, activeClass?.lastFoundAt, pathname === "/class/files");
	const counts = useTabCounts();
	// The dialog compares its mode by identity: one object per open.
	const editMode = useMemo(() => (editing && active ? { kind: "edit" as const, classId: active } : null), [editing, active]);
	return (
		<div data-testid="class-head" className="mx-auto w-full max-w-[908px] shrink-0 px-6 pt-10">
			<div className="flex items-center gap-4">
				{activeClass && <span aria-hidden className="h-14 w-3 shrink-0" style={{ background: classColorVar(activeClass.color) }} />}
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<p data-testid="class-head-name" title={activeClass?.name} className="truncate text-[38px] leading-[1.2] text-ink">
						{activeClass?.name ?? "Lessons with no class"}
					</p>
					{activeClass?.description && <p className="truncate text-lg text-ink-2">{activeClass.description}</p>}
				</div>
				<div id={ASIDE_ID} className="shrink-0 empty:hidden" />
				{activeClass && (
					<button type="button" data-testid="class-edit" onClick={() => setEditing(true)} className="lh-btn lh-btn-quiet shrink-0 text-[15px]">
						Edit class
					</button>
				)}
			</div>
			{/* The row's rule is a shadow: a scrolling row clips a tab that overhangs it. */}
			<nav aria-label={activeClass?.name ?? "Lessons with no class"} className="mt-[22px] flex gap-1.5 overflow-x-auto shadow-[inset_0_-2px_0_var(--border)]">
				{classTabs(!!activeClass).map((t) => {
					const selected = t.href === pathname;
					const count = t.count && counts[t.count];
					return (
						<Link
							key={t.href}
							href={t.href}
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
							{t.href === "/class/files" && unseenFiles && (
								<span data-testid="nav-files-new" className="bg-highlight px-1.5 text-sm text-ink">
									new
								</span>
							)}
						</Link>
					);
				})}
			</nav>
			<ClassDialog mode={editMode} onClose={() => setEditing(false)} />
		</div>
	);
}

const ASIDE_ID = "class-head-aside";

/** Puts a tab's own piece in the class head, left of "Edit class" (the
 *  Progress tab's signature). */
export function ClassHeadAside({ children }: { children: ReactNode }) {
	const [slot, setSlot] = useState<HTMLElement | null>(null);
	useEffect(() => setSlot(document.getElementById(ASIDE_ID)), []);
	return slot && createPortal(children, slot);
}

/** The count beside each tab; undefined until its list has loaded. */
function useTabCounts(): TabCounts {
	const { active, activeClass } = useClasses();
	const { chats } = useLessonList();
	const sheets = useClassSheets(active).view;
	const open = useOpenDeadlines().deadlines;
	const nowMs = useMinute();
	return {
		lessons: chats?.filter((c) => (c.classId ?? null) === active).length,
		files: activeClass?.fileCount,
		sheets: sheets ? sheetCount(sheets.cards) : undefined,
		deadlines: open && nowMs !== null ? open.filter((d) => d.classId === active && !isOverdue(d, nowMs)).length : undefined,
	};
}
