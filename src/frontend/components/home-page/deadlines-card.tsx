import { DEFAULT_TEACHER_NAME, type RhythmGap, type SpaceSummary } from "@/shared/core";
import { LoadFailed } from "@/frontend/components/load-failed";
import type { Leaving } from "@/frontend/components/presence";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { Pane } from "@/frontend/components/ui/pane";
import { AddDeadline } from "./add-deadline";
import { homeEmpty, type HomeLists } from "./home-page-model";
import { WeekColumns } from "./week-columns";
import { weekColumns, type WeekPick } from "./week-columns-model";

/**
 * Home's deadlines card: "Add" in its head, then the week as seven day
 * columns and Later, with the outlines of deadlines that look missing. With
 * no deadline and no outline at all, a sentence takes their place.
 */
export function DeadlinesCard({
	spaces,
	lists,
	outlines,
	nowMs,
	picked,
	onPick,
	onRetry,
	onAdd,
}: {
	spaces: readonly SpaceSummary[];
	/** Null when the deadlines failed to load. */
	lists: HomeLists | null;
	/** The open spaces' outlines, held while one leaves. */
	outlines: readonly Leaving<RhythmGap>[];
	nowMs: number;
	/** What the card above shows. */
	picked: WeekPick | null;
	onPick: (pick: WeekPick) => void;
	onRetry: () => void;
	onAdd: (spaceId: string) => void;
}) {
	const teacher = useTeacher()?.name ?? DEFAULT_TEACHER_NAME;
	const empty = lists && homeEmpty(lists, outlines.length, teacher);
	return (
		<Pane data-testid="today-deadlines" className="lh-card">
			<div className="lh-card-head">
				<h2 className="lh-card-title">Deadlines</h2>
				{lists && <AddDeadline spaces={spaces} onPick={onAdd} />}
			</div>
			{!lists ? (
				<LoadFailed message="Couldn't load your deadlines." onRetry={onRetry} className="py-10" />
			) : empty ? (
				<p data-testid="today-empty" className="text-[17px] text-ink-2">
					{empty}
				</p>
			) : (
				<WeekColumns columns={weekColumns(lists, outlines, nowMs)} spaces={spaces} picked={picked} onPick={onPick} />
			)}
		</Pane>
	);
}
