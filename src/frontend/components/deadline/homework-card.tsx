import { memo } from "react";
import type { DeadlineProgress, FileProblem } from "@/shared/core";
import { SELECT, SELECT_ARROW } from "@/frontend/components/ui/field";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";

/**
 * A homework or project deadline's problems: the problems themselves (the
 * next one not done is marked), Mark done once it is handed in, and the
 * assignment file the teacher reads the problems from.
 */
export const HomeworkCard = memo(function HomeworkCard({
	deadline: d,
	problems,
	files,
	assignmentId,
	saving,
	onPickAssignment,
	onOpenAssignment,
	onMarkDone,
}: {
	deadline: DeadlineProgress;
	problems: readonly FileProblem[];
	/** The space's files, for the assignment picker. */
	files: readonly { id: string; name: string }[];
	assignmentId: string | undefined;
	saving: boolean;
	onPickAssignment: (fileId: string | null) => void;
	/** Opens the assignment on the desktop; absent in a browser. */
	onOpenAssignment?: () => void;
	onMarkDone: (done: boolean) => void;
}) {
	const next = d.done ? undefined : problems.find((p) => !p.done);
	return (
		<Pane data-testid="homework-card" className="@container lh-card">
			<div className="lh-card-head">
				<h2 className="lh-card-title">Problems</h2>
				<button type="button" data-testid="homework-mark-done" disabled={saving} onClick={() => onMarkDone(!d.done)} className="lh-btn lh-btn-quiet">
					{d.done ? "Mark not done" : "Mark done"}
				</button>
			</div>
			{problems.length > 0 ? (
				<ol data-testid="homework-problems" className="gap-x-(--lh-inset) @[760px]:columns-2">
					{problems.map((p) => (
						<li key={p.number} data-testid="homework-problem" data-done={p.done || undefined} data-next={p === next || undefined} className="flex min-w-0 break-inside-avoid items-center gap-3 py-1 text-item">
							<span className={cn("flex h-8 w-11 shrink-0 items-center justify-center lh-notch font-count text-base", p.done ? "bg-ink text-(--background)" : p === next ? "bg-highlight text-ink" : "lh-well text-ink")}>{p.number}</span>
							<span title={p.title} className={cn("min-w-0 flex-1 truncate", p.done ? "text-ink-2" : "text-ink")}>
								{p.title}
							</span>
							{p.done && <PixelIcon name="check" size={10} className="text-ink" />}
						</li>
					))}
				</ol>
			) : (
				<p data-testid="homework-none" className="text-ui text-ink-2">
					{assignmentId ? "The teacher lists its problems when you start working on it." : "Pick its assignment file, and the teacher lists its problems when you start working on it."}
				</p>
			)}
			<label className="flex items-center gap-2.5 text-ui text-ink">
				<span className="min-w-0 flex-1">Assignment file</span>
				<span className="relative w-[220px] max-w-[55%] shrink-0">
					<select
						data-testid="homework-assignment"
						value={assignmentId ?? ""}
						disabled={saving}
						onChange={(e) => onPickAssignment(e.target.value || null)}
						className={SELECT}
					>
						<option value="">None picked</option>
						{files.map((f) => (
							<option key={f.id} value={f.id}>
								{f.name}
							</option>
						))}
					</select>
					<PixelIcon name="chevron" className={SELECT_ARROW} />
				</span>
				{assignmentId && onOpenAssignment && (
					<button type="button" data-testid="homework-assignment-open" onClick={onOpenAssignment} className="lh-btn lh-btn-quiet shrink-0">
						Open
					</button>
				)}
			</label>
		</Pane>
	);
});
