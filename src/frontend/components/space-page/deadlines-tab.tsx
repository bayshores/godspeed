import { useEffect, useMemo, useState } from "react";
import { LoadingLine, useWaited } from "@/frontend/components/loading";
import { Link, useSearchParams } from "react-router";
import type { SpaceDeadline, DeadlineProgress, SheetCard } from "@/shared/core";
import { useSpaceSheets } from "@/frontend/components/cheat-sheet/space-sheets";
import { studioPath } from "@/frontend/components/cheat-sheet/use-cheat-sheet";
import { spaceColorVar } from "@/frontend/components/space-color";
import { useSpaces } from "@/frontend/components/space-context";
import { useMinute } from "@/frontend/components/countdown";
import { DeadlineBlock } from "@/frontend/components/deadline/deadline-block";
import { useSpaceRecord } from "@/frontend/components/files/space-record";
import { dueThisWeek } from "@/frontend/components/home-page/home-page-model";
import { LoadFailed } from "@/frontend/components/load-failed";
import { deadlineHref } from "@/frontend/components/overview/overview-model";
import { PickSpace } from "@/frontend/components/pick-space";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { useOpenDeadlines } from "@/frontend/components/use-open-deadlines";
import { useProgress } from "@/frontend/components/use-progress";
import { cn } from "@/frontend/lib/utils";
import { DeadlineDialog } from "./deadline-dialog";
import { WaitingDeadline } from "./waiting-deadline";
import { deadlineLine, deadlineLists } from "./deadlines-tab-model";

/** Deadlines in one column, or two once a row would be a wide empty slab. */
const LIST = "grid gap-(--lh-gap) @[1100px]/page:grid-cols-2";

/**
 * The space's deadlines: "Coming up" with "Add a deadline" (and an
 * interview still waiting for its date), then "Done or past". A row opens
 * the deadline's page; "Mark done" and "Undo" work in place, and its cheat
 * sheet opens (or is made) from the row.
 */
export function DeadlinesTab() {
	const { active, activeSpace } = useSpaces();
	const { record, failed, reload } = useSpaceRecord(active);
	const waited = useWaited(!!record);
	const progress = useProgress().data;
	const { markDone, undo } = useOpenDeadlines();
	const sheets = useSpaceSheets(active).view;
	const nowMs = useMinute();
	const [adding, setAdding] = useState(false);
	// "Add a deadline" on another page lands here with ?add=1: the dialog opens once.
	const [params, setParams] = useSearchParams();
	const addAsked = params.has("add");
	useEffect(() => {
		if (!addAsked) return;
		setAdding(true);
		setParams(
			(p) => {
				p.delete("add");
				return p;
			},
			{ replace: true },
		);
	}, [addAsked, setParams]);
	// The dialog compares its mode by identity: one object per open.
	const addMode = useMemo(() => (adding && record ? { spaceId: record.id, deadline: null, files: record.files } : null), [adding, record]);
	const progressOf = useMemo(() => new Map((progress?.spaceId === active ? progress.deadlines : []).map((d) => [d.id, d])), [progress, active]);

	if (!active || !activeSpace) {
		return (
			<div className="lh-page pt-(--lh-gap)">
				<PickSpace line="Pick a space to see its deadlines." />
			</div>
		);
	}
	const sheetOf = new Map(sheets?.cards.map((c) => [c.deadlineId, c]));
	const lists = record && nowMs !== null ? deadlineLists(record.deadlines ?? [], nowMs) : null;
	const row = (d: SpaceDeadline) => (
		<DeadlineRow
			key={d.id}
			deadline={d}
			progress={progressOf.get(d.id)}
			sheet={sheetOf.get(d.id)}
			color={spaceColorVar(activeSpace.color)}
			nowMs={nowMs!}
			onDone={() => markDone({ ...d, spaceId: active, spaceName: activeSpace.name })}
			onUndo={() => undo({ ...d, spaceId: active, spaceName: activeSpace.name })}
		/>
	);
	return (
		<div data-testid="deadlines-tab" className="@container/page lh-page flex flex-col gap-(--lh-head-gap) pt-(--lh-gap) pb-(--lh-page-end)">
			<section className="flex flex-col gap-3">
				<div className="lh-card-head">
					<h2 className="lh-card-title">Coming up</h2>
					<button type="button" data-testid="deadline-add" disabled={!record} onClick={() => setAdding(true)} className="lh-btn lh-btn-quiet text-[15px]">
						<PixelIcon name="plus" />
						Add a deadline
					</button>
				</div>
				<WaitingDeadline record={record} />
				{!record && failed ? (
					<LoadFailed message="Couldn't load this space's deadlines." onRetry={() => void reload()} />
				) : lists && lists.coming.length === 0 ? (
					<p data-testid="deadlines-none" className="text-[15px] text-ink-2">
						Nothing is coming up.
					</p>
				) : lists ? (
					<ul className={cn(LIST, waited && "lh-set")}>{lists.coming.map(row)}</ul>
				) : (
					<LoadingLine className="text-[15px]" />
				)}
			</section>
			{lists && lists.past.length > 0 && (
				<section className="flex flex-col gap-3">
					<div className="lh-card-head">
						<h2 className="lh-card-title">Done or past</h2>
					</div>
					<ul className={LIST}>{lists.past.map(row)}</ul>
				</section>
			)}
			<DeadlineDialog mode={addMode} onClose={() => setAdding(false)} />
		</div>
	);
}

/** One deadline: its block (days left, the Done stamp, or "was due"), its
 *  name and line, its cheat sheet, and "Mark done" or "Undo". The whole row
 *  opens its page. */
function DeadlineRow({
	deadline: d,
	progress,
	sheet,
	color,
	nowMs,
	onDone,
	onUndo,
}: {
	deadline: SpaceDeadline;
	progress: DeadlineProgress | undefined;
	/** Where its cheat sheet is; undefined while that loads and for an interview. */
	sheet: SheetCard | undefined;
	/** The space's color. */
	color: string;
	nowMs: number;
	onDone: () => void;
	onUndo: () => void;
}) {
	return (
		<li data-testid={`deadline-row-${d.id}`} data-teacher-target={`deadline:${d.id}`}>
			<Pane className="flex h-full min-h-[84px] items-center overflow-hidden hover:[--lh-sheet:var(--color-tone)]">
				<DeadlineBlock deadline={d} color={color} nowMs={nowMs} size="list" pale={!dueThisWeek(d, nowMs)} />
				<span className="flex min-w-0 flex-1 flex-col gap-[3px] px-(--lh-inset) py-3">
					{/* Stretched over the row, so a click anywhere opens the page. */}
					<Link to={deadlineHref(d.id)} data-testid="deadline-open" title={d.name} className={cn("text-xl leading-tight break-words after:absolute after:inset-0", d.done ? "text-ink-3" : "text-ink")}>
						{d.name}
					</Link>
					<span className="text-base leading-snug text-ink-2">{deadlineLine(d, progress, nowMs)}</span>
				</span>
				<span className="flex shrink-0 items-center gap-2.5 pr-(--lh-inset)">
					{sheet && (
						<Link to={studioPath(d.id)} data-testid="deadline-sheet" className="lh-btn lh-btn-small lh-btn-quiet relative">
							{sheet.status === "none" ? "Make cheat sheet" : "Cheat sheet"}
						</Link>
					)}
					<button type="button" data-testid={d.done ? "deadline-undo" : "deadline-done"} onClick={d.done ? onUndo : onDone} className="lh-btn lh-btn-small lh-btn-quiet relative">
						{d.done ? "Undo" : "Mark done"}
					</button>
					<PixelIcon name="chevron" className="h-3.5 text-ink" />
				</span>
			</Pane>
		</li>
	);
}
