import { deadlineStudyLabel, studyLabel, type DeadlineProgress } from "@/shared/core";
import { BIG_KEY, MAIN_KEY } from "@/frontend/components/overview/styles";
import { homeworkStartId } from "@/frontend/components/study-page/use-lesson-start";
import { Key } from "@/frontend/components/ui/key";

/** The key that works on a homework or project. */
export function workLabel(name: string): string {
	return `Work on ${name}`;
}

/** The same key where the deadline's name is beside it. */
export const WORK_ON_IT = "Work on it";

/**
 * A homework or project deadline's two keys, where its name is beside
 * them: Study first, in grey (gone once its date passed, as Study is), and
 * Work on it, filled. They are as wide as their words and one height; the
 * whole label, with the name and Study's topic count, is on hover.
 * None once it is done.
 */
export function DeadlineKeys({
	deadline: d,
	busyOn,
	onStudy,
	onWork,
}: {
	deadline: Pick<DeadlineProgress, "id" | "name" | "done" | "daysUntil" | "continueStudy">;
	/** The id of the lesson start in flight, if any. */
	busyOn: string | null;
	onStudy: () => void;
	onWork: () => void;
}) {
	if (d.done) return null;
	return (
		<div data-testid="deadline-keys" className="flex flex-wrap items-end justify-end gap-2.5">
			{d.daysUntil >= 0 && (
				<Key data-testid="deadline-study" title={deadlineStudyLabel(d.continueStudy, d.name)} busy={busyOn === d.id} disabled={busyOn !== null} onClick={onStudy} className={BIG_KEY}>
					<span className="min-w-0 truncate">{studyLabel(d.continueStudy)}</span>
				</Key>
			)}
			<Key data-testid="deadline-work" title={workLabel(d.name)} busy={busyOn === homeworkStartId(d.id)} disabled={busyOn !== null} onClick={onWork} className={MAIN_KEY}>
				<span className="min-w-0 truncate">{WORK_ON_IT}</span>
			</Key>
		</div>
	);
}
