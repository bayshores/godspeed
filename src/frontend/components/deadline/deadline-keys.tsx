import { deadlineStudyLabel, type DeadlineProgress } from "@/shared/core";
import { cn } from "@/frontend/lib/utils";

/** The key that works on a homework or project. */
export function workLabel(name: string): string {
	return `Work on ${name}`;
}

/**
 * A homework or project deadline's two keys: Study for it first, in grey
 * (gone once its date passed, as Study is), and Work on it, filled. They
 * sit side by side where both fit and stack in a narrow card; a long name
 * is cut off with its whole label on hover. None once it is done.
 */
export function DeadlineKeys({
	deadline: d,
	busy,
	compact = false,
	onStudy,
	onWork,
}: {
	deadline: Pick<DeadlineProgress, "name" | "done" | "daysUntil" | "continueStudy">;
	/** A lesson is starting. */
	busy: boolean;
	/** The smaller keys of a side card. */
	compact?: boolean;
	onStudy: () => void;
	onWork: () => void;
}) {
	if (d.done) return null;
	const size = compact ? "h-auto py-3 text-[15px]" : "h-[52px] text-[17px]";
	const key = "lh-btn min-w-0 flex-1 basis-[200px] justify-center px-[18px]";
	const study = deadlineStudyLabel(d.continueStudy, d.name);
	const work = workLabel(d.name);
	return (
		<div data-testid="deadline-keys" className="flex flex-wrap gap-2.5">
			{d.daysUntil >= 0 && (
				<button type="button" data-testid="deadline-study" title={study} disabled={busy} onClick={onStudy} className={cn(key, size)}>
					<span className="min-w-0 truncate">{study}</span>
				</button>
			)}
			<button type="button" data-testid="deadline-work" title={work} disabled={busy} onClick={onWork} className={cn(key, size, "lh-btn-main")}>
				<span className="min-w-0 truncate">{work}</span>
			</button>
		</div>
	);
}
