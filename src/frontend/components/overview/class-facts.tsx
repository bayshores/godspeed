import { memo, useMemo } from "react";
import Link from "next/link";
import { RAMP_COLORS, UNTESTED_COLOR, type ProgressPayload } from "@/shared/core";
import { UNSTUDIED_CELL, factCells } from "@/frontend/components/fact-cells";
import { Pane } from "@/frontend/components/ui/pane";

/** The studied squares fill in over this long, one at a time. */
const FILL_MS = 400;

/**
 * THE CLASS'S FACTS (Progress): one square per fact, colored by how often
 * it's answered right (red to green), studied but unanswered ones grey,
 * the rest dim, with the facts studied in the sheet's name and what the
 * colors mean under the grid. A class with no study files offers its
 * Files tab.
 */
export const ClassFacts = memo(function ClassFacts({ progress }: { progress: Pick<ProgressPayload, "facts" | "files"> }) {
	const cells = useMemo(() => factCells(progress.facts), [progress.facts]);
	// Studied: every square that isn't dim, so the count matches the grid.
	const studied = cells.filter((c) => c !== UNSTUDIED_CELL).length;
	const total = cells.length;
	const name = (
		<>
			Facts <span className="font-count text-base text-ink-2">{`${studied} of ${total} studied`}</span>
		</>
	);
	return (
		<Pane name={total > 0 ? name : "Facts"} data-testid="class-facts" className="[&>h2]:p-0 [&>h2]:pb-3 px-5 pt-4 pb-4">
			{progress.files.length === 0 ? (
				<div className="flex flex-col items-start gap-3">
					<p className="text-[15px] text-ink-2">No study files yet.</p>
					<Link href="/class/files" prefetch={false} data-testid="class-facts-add-files" className="lh-btn">
						Add files
					</Link>
				</div>
			) : total === 0 ? (
				<p className="text-[15px] text-ink-2">No facts yet. They show up once your agent reads the files.</p>
			) : (
				<div className="flex flex-col gap-4">
					<div role="img" aria-label={`${studied} of ${total} facts studied`} className="flex flex-wrap gap-[3px]">
						{cells.map((color, i) => (
							<span
								key={i}
								className={color === UNSTUDIED_CELL ? "size-[13px]" : "lh-block-in size-[13px]"}
								style={{ background: color, "--lh-block-delay": `${Math.round((i * FILL_MS) / total)}ms` } as React.CSSProperties}
							/>
						))}
					</div>
					<FactKey />
				</div>
			)}
		</Pane>
	);
});

/** What the squares' colors mean. */
function FactKey() {
	return (
		<p data-testid="fact-key" className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-ink-2">
			<span>One square is one fact</span>
			<span className="flex items-center gap-[3px]">
				{RAMP_COLORS.map((c) => (
					<span key={c} aria-hidden className="size-2.5" style={{ background: c }} />
				))}
				<span className="ml-1.5">Answered, wrong to right</span>
			</span>
			<span className="flex items-center gap-1.5">
				<span aria-hidden className="size-2.5" style={{ background: UNTESTED_COLOR }} />
				In a lesson, not answered
			</span>
			<span className="flex items-center gap-1.5">
				<span aria-hidden className="size-2.5" style={{ background: UNSTUDIED_CELL }} />
				Not studied
			</span>
		</p>
	);
}
