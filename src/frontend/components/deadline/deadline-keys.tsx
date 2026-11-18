import { deadlineStudyLabel, studyLabel, type DeadlineProgress } from "@/shared/core";
import { BIG_KEY, MAIN_KEY } from "@/frontend/components/overview/styles";
import { cn } from "@/frontend/lib/utils";

/** The key that works on a homework or project. */
export function workLabel(name: string): string {
	return `Work on ${name}`;
}

/**
 * A homework or project deadline's two keys: Study for it first, in grey
 * (gone once its date passed, as Study is), and Work on it, filled. They
 * are as wide as their words, at the right, side by side where both fit
 * and wrapped where not; a long name is cut off with its whole label on
 * hover, as is Study's topic count. In a narrow card under the deadline's
 * name the keys leave the name out ("Study", "Work on it"), are one
 * height, and only Work on it is dark.
 * None once it is done.
 */
export function DeadlineKeys({
	deadline: d,
	busy,
	narrow = false,
	onStudy,
	onWork,
}: {
	deadline: Pick<DeadlineProgress, "name" | "done" | "daysUntil" | "continueStudy">;
	/** A lesson is starting. */
	busy: boolean;
	/** A side card's keys, under the deadline's name: short, label width, at the right. */
	narrow?: boolean;
	onStudy: () => void;
	onWork: () => void;
}) {
	if (d.done) return null;
	const study = deadlineStudyLabel(d.continueStudy, d.name);
	const studyShort = narrow ? studyLabel(d.continueStudy) : deadlineStudyLabel(d.continueStudy && { ...d.continueStudy, total: undefined }, d.name);
	const work = workLabel(d.name);
	const workShort = narrow ? "Work on it" : work;
	return (
		<div data-testid="deadline-keys" className={cn("flex flex-wrap justify-end gap-2.5", narrow && "items-end")}>
			{d.daysUntil >= 0 && (
				<button type="button" data-testid="deadline-study" title={study} disabled={busy} onClick={onStudy} className={BIG_KEY}>
					<span className="min-w-0 truncate">{studyShort}</span>
				</button>
			)}
			<button type="button" data-testid="deadline-work" title={work} disabled={busy} onClick={onWork} className={MAIN_KEY}>
				<span className="min-w-0 truncate">{workShort}</span>
			</button>
		</div>
	);
}
