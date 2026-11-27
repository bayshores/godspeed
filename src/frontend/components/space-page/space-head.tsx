import { useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useLitMarker } from "@/frontend/components/lit-marker";
import { useSpaces } from "@/frontend/components/space-context";
import { STRIP, useTabStrip } from "@/frontend/components/tab-strip";
import { SpaceDialog } from "@/frontend/components/space-dialog";
import { useMinute } from "@/frontend/components/countdown";
import { isOverdue } from "@/frontend/components/deadlines-model";
import { useUnseenFiles } from "@/frontend/components/files/files-seen";
import { useOpenDeadlines } from "@/frontend/components/use-open-deadlines";
import { BarActions } from "@/frontend/components/top-bar/bar-slots";
import { barWord } from "@/frontend/components/top-bar/bar-look";
import { KeyHint, keyShortcutProps } from "@/frontend/components/ui/key-hint";
import { useProgress } from "@/frontend/components/use-progress";
import type { ShownPlugin } from "@/frontend/lib/use-plugins-at";
import { cn } from "@/frontend/lib/utils";
import { HeadSignature } from "./head-signature";
import { spaceTabs, studiedShare, tabCount, type TabCounts } from "./space-head-model";

/**
 * The head of every space page: the tabs with their counts, then the
 * space's signature, inked as far as its facts are studied. "Edit
 * space" is a word in the top bar's right side. The top bar's tab names
 * the space, so the head does not; with no space picked it names the
 * lessons that belong to none.
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
	const tabsRef = useRef<HTMLDivElement>(null);
	const underline = useLitMarker(tabsRef, '[aria-current="page"]', pathname);
	const strip = useTabStrip<HTMLElement>('[aria-current="page"]', `${pathname} ${plugins.length}`);
	const editMode = useMemo(() => (editing ? { kind: "edit" as const, spaceId: editing } : null), [editing]);
	return (
		<div data-testid="space-head" className={cn("lh-page shrink-0", activeSpace ? "pt-4" : "pt-(--lh-page-top)")}>
			{!activeSpace && (
				<p data-testid="space-head-name" className="lh-page-title truncate">
					Lessons with no space
				</p>
			)}
			{/* In a page squeezed narrow the tabs stay on their line and scroll, so the page under them never moves down. */}
			<div ref={tabsRef} className={cn("lh-tabs relative isolate items-center", !activeSpace && "mt-(--lh-head-gap)")}>
				<div ref={underline} hidden aria-hidden className="lh-lit-marker lh-tab-line" />
				<nav {...strip} aria-label={activeSpace?.name ?? "Lessons with no space"} className={cn("flex flex-[0_1_auto] gap-x-1.5", STRIP)}>
					{spaceTabs(activeSpace ? "space" : "none", plugins).map((t) => {
						const selected = t.href === pathname;
						const count = tabCount(t, counts);
						return (
							<Link
								key={t.href}
								to={t.href}
								data-testid={t.testid}
								aria-current={selected ? "page" : undefined}
								{...(t.action && keyShortcutProps(t.action))}
								className="lh-press lh-tab"
							>
								{t.label}
								{t.action && <KeyHint action={t.action} />}
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
			</div>
			{/* Last among the page words: Files and Graph put theirs before it. */}
			{activeSpace && (
				<BarActions>
					<button type="button" data-testid="space-edit" onClick={() => setEditing(activeSpace.id)} className={cn(barWord(false), "order-last")}>
						Edit space
					</button>
				</BarActions>
			)}
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
