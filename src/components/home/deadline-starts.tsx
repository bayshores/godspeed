import { deadlineStudyLabel, type DeadlineProgress } from "@/core";

/** The start page's one-click Study for each upcoming deadline ("Continue
 *  studying for" while its latest session is unfinished). */
export function DeadlineStarts({
	deadlines,
	busy,
	onStudy,
}: {
	deadlines: readonly DeadlineProgress[];
	busy: boolean;
	onStudy: (deadline: DeadlineProgress) => void;
}) {
	return (
		<div data-testid="home-deadlines" className="mt-5 flex flex-wrap gap-0.5">
			{deadlines.map((d) => (
				<button
					key={d.id}
					type="button"
					data-testid="home-study-deadline"
					disabled={busy}
					onClick={() => onStudy(d)}
					className="lh-press bg-tone px-3.5 py-2 text-[13.5px] font-bold text-ink hover:bg-tone-2 disabled:opacity-60"
				>
					{deadlineStudyLabel(d.continueStudy, d.name)}
				</button>
			))}
		</div>
	);
}
