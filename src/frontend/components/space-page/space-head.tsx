import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { useSpaces } from "@/frontend/components/space-context";
import { SpaceDialog } from "@/frontend/components/space-dialog";
import { useMinute } from "@/frontend/components/countdown";
import { isOverdue } from "@/frontend/components/deadlines-model";
import { useUnseenFiles } from "@/frontend/components/files/files-seen";
import { useOpenDeadlines } from "@/frontend/components/use-open-deadlines";
import { useProgress } from "@/frontend/components/use-progress";
import type { ShownPlugin } from "@/frontend/lib/use-plugins-at";
import { cn } from "@/frontend/lib/utils";
import { HeadSignature } from "./head-signature";
import { spaceTabs, studiedShare, tabCount, type TabCounts } from "./space-head-model";

/**
 * The head of every space page: the tabs with their counts, then the
 * space's signature, inked as far as its facts are studied, and "Edit
 * space" at the end of their row. The top bar's tab names the space, so
 * the head does not; with no space picked it names the lessons that belong
 * to none.
 */
export function SpaceHead({ plugins }: { plugins: readonly ShownPlugin[] }) {
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
		<div data-testid="space-head" className={cn("lh-page shrink-0", activeSpace ? "pt-4" : "pt-10")}>
			{!activeSpace && (
				<p data-testid="space-head-name" className="truncate text-[38px] leading-[1.2] text-ink">
					Lessons with no space
				</p>
			)}
			{/* When the tabs and Edit space don't fit one line, Edit space goes above the tabs; in a page
			    squeezed narrower still the tabs wrap, so none hides behind a scroll. */}
			<div className={cn("flex flex-wrap-reverse items-center shadow-[inset_0_-2px_0_var(--border)]", !activeSpace && "mt-[22px]")}>
				<nav aria-label={activeSpace?.name ?? "Lessons with no space"} className="flex min-w-0 flex-[0_1_auto] flex-wrap gap-x-1.5">
					{spaceTabs(activeSpace ? "space" : "none", plugins).map((t) => {
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
				{/* The signature takes what the tabs and Edit space leave, so it never pushes either to a new line. */}
				{activeSpace?.signature && (
					<span className="flex min-w-0 flex-[1_1_0] px-4">
						<HeadSignature signature={activeSpace.signature} share={share} />
					</span>
				)}
				{activeSpace && (
					<button type="button" data-testid="space-edit" onClick={() => setEditing(activeSpace.id)} className="lh-btn lh-btn-quiet ml-auto shrink-0 text-[15px]">
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
	const open = useOpenDeadlines().deadlines;
	const nowMs = useMinute();
	return {
		studied: share === null ? undefined : Math.round(share * 100),
		files: activeSpace?.fileCount,
		deadlines: open && nowMs !== null ? open.filter((d) => d.spaceId === active && !isOverdue(d, nowMs)).length : undefined,
	};
}
