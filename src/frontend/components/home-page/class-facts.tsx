import { memo, useMemo } from "react";
import { RAMP_COLORS, UNTESTED_COLOR, type ClassSummary, type ProgressPayload } from "@/shared/core";
import { Pane } from "@/frontend/components/ui/pane";
import { UNSTUDIED_CELL, factCells } from "./home-page-model";

/** The studied squares fill in over this long, one at a time. */
const FILL_MS = 400;

/**
 * A CLASS'S FACTS (Home): one square per fact, colored by how often it's
 * answered right (red to green), studied but unanswered ones grey, the
 * rest dim. The pane's name carries the facts studied ("cse29 32/333").
 * A class with no study files offers its Files page.
 */
export const ClassFacts = memo(function ClassFacts({
	cls,
	progress,
	onOpenFiles,
}: {
	cls: Pick<ClassSummary, "id" | "name">;
	progress: Pick<ProgressPayload, "facts" | "files">;
	onOpenFiles: (classId: string) => void;
}) {
	const cells = useMemo(() => factCells(progress.facts), [progress.facts]);
	// Studied: every square that isn't dim, so the count matches the grid.
	const studied = cells.filter((c) => c !== UNSTUDIED_CELL).length;
	const total = cells.length;
	const name = (
		<>
			{cls.name.toLowerCase()} <span className="text-ink-3 tabular-nums">{`${studied}/${total}`}</span>
		</>
	);
	return (
		<Pane name={name} data-testid={`class-facts-${cls.id}`} className="px-5 pt-5 pb-4">
			{progress.files.length === 0 ? (
				<div className="flex flex-col items-start gap-3">
					<p className="text-sm text-ink-2">No study files yet.</p>
					<button type="button" data-testid="class-facts-add-files" onClick={() => onOpenFiles(cls.id)} className="lh-btn">
						+ add files
					</button>
				</div>
			) : cells.length === 0 ? (
				<p className="text-sm text-ink-2">No facts yet. They show up once your agent reads the files.</p>
			) : (
				<div role="img" aria-label={`${studied} of ${total} facts studied`} className="flex flex-wrap gap-[3px]">
					{cells.map((color, i) => (
						<span
							key={i}
							className={color === UNSTUDIED_CELL ? "size-[13px]" : "lh-block-in size-[13px]"}
							style={{ background: color, "--lh-block-delay": `${Math.round((i * FILL_MS) / cells.length)}ms` } as React.CSSProperties}
						/>
					))}
				</div>
			)}
		</Pane>
	);
});

/** What the squares' colors mean, once under all the grids. */
export function FactKey() {
	return (
		<p data-testid="fact-key" className="flex flex-wrap items-center gap-x-5 gap-y-1 px-1 text-xs text-ink-2">
			<span>one square is one fact</span>
			<span className="flex items-center gap-[3px]">
				{RAMP_COLORS.map((c) => (
					<span key={c} aria-hidden className="size-2.5" style={{ background: c }} />
				))}
				<span className="ml-1.5">answered, wrong to right</span>
			</span>
			<span className="flex items-center gap-1.5">
				<span aria-hidden className="size-2.5" style={{ background: UNTESTED_COLOR }} />
				in a lesson, not answered
			</span>
			<span className="flex items-center gap-1.5">
				<span aria-hidden className="size-2.5" style={{ background: UNSTUDIED_CELL }} />
				not studied
			</span>
		</p>
	);
}
