import { useMemo, useState } from "react";
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
import { useProgress } from "@/frontend/components/use-progress";
import { cn } from "@/frontend/lib/utils";
import { HeadSignature } from "./head-signature";
import { spaceTabs, sheetCount, studiedShare, tabCount, type TabCounts } from "./space-head-model";

/**
 * The head of every space page: the space's color bar and name, its
 * signature inked as far as its facts are studied in the room the name
 * leaves, then the tabs with their counts and "Edit space" at the end of
 * their row. With no space picked it names the lessons that belong to none.
 */
export function SpaceHead() {
	const { pathname } = useLocation();
	const { active, activeSpace } = useSpaces();
	/** The space Edit opened for: it stays open while that space is deleted. */
	const [editing, setEditing] = useState<string | null>(null);
	const unseenFiles = useUnseenFiles(active, activeSpace?.lastFoundAt, pathname === "/space/files");
	const share = useStudiedShare();
	const counts = useTabCounts(share);
	// The dialog compares its mode by identity: one object per open.
	const editMode = useMemo(() => (editing ? { kind: "edit" as const, spaceId: editing } : null), [editing]);
	return (
		<div data-testid="space-head" className="mx-auto w-full max-w-[908px] shrink-0 px-6 pt-10">
			{/* As tall as a signature, so the tabs sit at one height in every space. */}
			<div className="flex min-h-16 items-center gap-4">
				{activeSpace && <span aria-hidden className="h-12 w-3 shrink-0" style={{ background: spaceColorVar(activeSpace.color) }} />}
				<p data-testid="space-head-name" title={activeSpace?.name} className={cn("min-w-0 truncate text-[38px] leading-[1.2] text-ink", !activeSpace?.signature && "flex-1")}>
					{activeSpace?.name ?? "Lessons with no space"}
				</p>
				{activeSpace?.signature && <HeadSignature signature={activeSpace.signature} share={share} />}
			</div>
			<div className="mt-[22px] flex items-center shadow-[inset_0_-2px_0_var(--border)]">
				<nav aria-label={activeSpace?.name ?? "Lessons with no space"} className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
					{spaceTabs(activeSpace ? "space" : "none").map((t) => {
						const selected = t.href === pathname;
						const count = tabCount(t, counts);
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
				{activeSpace && (
					<button type="button" data-testid="space-edit" onClick={() => setEditing(activeSpace.id)} className="lh-btn lh-btn-quiet shrink-0 text-[15px]">
						Edit space
					</button>
				)}
			</div>
			<SpaceDialog mode={editMode} onClose={() => setEditing(null)} />
		</div>
	);
}

/** The share of the active space's facts studied, 0 to 1; null until its
 *  progress has loaded, with no space, and for a space with no facts. */
function useStudiedShare(): number | null {
	const { active } = useSpaces();
	const { data } = useProgress();
	return useMemo(() => (active && data?.spaceId === active ? studiedShare(data.facts) : null), [active, data]);
}

/** The count beside each tab; undefined until its list has loaded. */
function useTabCounts(share: number | null): TabCounts {
	const { active, activeSpace } = useSpaces();
	const { chats } = useLessonList();
	const sheets = useSpaceSheets(active).view;
	const open = useOpenDeadlines().deadlines;
	const nowMs = useMinute();
	return {
		studied: share === null ? undefined : Math.round(share * 100),
		lessons: chats?.filter((c) => (c.spaceId ?? null) === active).length,
		files: activeSpace?.fileCount,
		sheets: sheets ? sheetCount(sheets.cards) : undefined,
		deadlines: open && nowMs !== null ? open.filter((d) => d.spaceId === active && !isOverdue(d, nowMs)).length : undefined,
	};
}
