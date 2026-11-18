import { DEFAULT_TEACHER_NAME, type SpaceSummary } from "@/shared/core";
import { LoadFailed } from "@/frontend/components/load-failed";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { Pane } from "@/frontend/components/ui/pane";
import { AddDeadline } from "./add-deadline";
import { todayEmpty, type TodayLists } from "./home-page-model";
import { WeekColumns } from "./week-columns";
import { weekColumns } from "./week-columns-model";

/**
 * Today's deadlines card: "Add" in its head, then the week as seven day
 * columns and Later. With no deadline at all, a sentence takes their place.
 */
export function DeadlinesCard({
	spaces,
	lists,
	nowMs,
	picked,
	onPick,
	onRetry,
	onAdd,
}: {
	spaces: readonly SpaceSummary[];
	/** Null when the deadlines failed to load. */
	lists: TodayLists | null;
	nowMs: number;
	/** The deadline the card above shows. */
	picked: string | null;
	onPick: (d: OpenDeadline) => void;
	onRetry: () => void;
	onAdd: (spaceId: string) => void;
}) {
	const teacher = useTeacher()?.name ?? DEFAULT_TEACHER_NAME;
	const empty = lists && todayEmpty(lists, teacher);
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
				<WeekColumns columns={weekColumns(lists, nowMs)} spaces={spaces} picked={picked} onPick={onPick} />
			)}
		</Pane>
	);
}
