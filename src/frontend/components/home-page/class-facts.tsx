import { memo, useMemo } from "react";
import type { ClassSummary, ProgressPayload } from "@/shared/core";
import { studiedFacts } from "@/frontend/components/overview/runway-model";
import { Pane } from "@/frontend/components/ui/pane";
import { factCells } from "./home-page-model";

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
	const { studied, total } = studiedFacts(progress.facts);
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
						<span key={i} className="size-[13px]" style={{ background: color }} />
					))}
				</div>
			)}
		</Pane>
	);
});
