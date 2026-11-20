import { memo } from "react";
import type { DeadlineProgress, HomeworkProblem } from "@/shared/core";
import { SELECT, SELECT_ARROW } from "@/frontend/components/ui/field";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { DeadlineKeys } from "./deadline-keys";

/**
 * A homework or project deadline's problems: the problems themselves (the
 * next one not done is marked), Mark done once it is handed in, the
 * assignment file the teacher reads the problems from, and its keys: Study
 * for it and Work on it.
 */
export const HomeworkCard = memo(function HomeworkCard({
	deadline: d,
	problems,
	files,
	assignmentId,
	busyOn,
	error,
	saving,
	onStudy,
	onWork,
	onPickAssignment,
	onOpenAssignment,
	onMarkDone,
}: {
	deadline: DeadlineProgress;
	problems: readonly HomeworkProblem[];
	/** The space's files, for the assignment picker. */
	files: readonly { id: string; name: string }[];
	assignmentId: string | undefined;
	/** The id of the lesson start in flight, if any. */
	busyOn: string | null;
	/** Why the last start failed. */
	error: string | null;
	saving: boolean;
	onStudy: () => void;
	onWork: () => void;
	onPickAssignment: (fileId: string | null) => void;
	/** Opens the assignment on the desktop; absent in a browser. */
	onOpenAssignment?: () => void;
	onMarkDone: (done: boolean) => void;
}) {
	const next = d.done ? undefined : problems.find((p) => !p.done);
	return (
		<Pane data-testid="homework-card" className="lh-card">
			<div className="lh-card-head">
				<h2 className="lh-card-title">Problems</h2>
				<button type="button" data-testid="homework-mark-done" disabled={saving} onClick={() => onMarkDone(!d.done)} className="lh-btn lh-btn-quiet text-[15px]">
					{d.done ? "Mark not done" : "Mark done"}
				</button>
			</div>
			{problems.length > 0 ? (
				<ol data-testid="homework-problems" className="flex flex-col">
					{problems.map((p) => (
						<li key={p.number} data-testid="homework-problem" data-done={p.done || undefined} data-next={p === next || undefined} className="flex min-w-0 items-center gap-3 py-[7px] text-[15px]">
							<span aria-hidden className="flex w-4 shrink-0 justify-center text-ink">
								{p.done && <PixelIcon name="check" className="h-2" />}
							</span>
							<span className="w-7 shrink-0 font-count text-ink">{p.number}</span>
							<span title={p.title} className={cn("min-w-0 flex-1 truncate", p.done ? "text-ink-2" : "text-ink")}>
								{p.title}
							</span>
							{p.done && <span className="shrink-0 text-base text-ans-right">right</span>}
						</li>
					))}
				</ol>
			) : (
				<p data-testid="homework-none" className="text-[15px] text-ink-2">
					{assignmentId ? "The teacher lists its problems when you start working on it." : "Pick its assignment file, and the teacher lists its problems when you start working on it."}
				</p>
			)}
			<label className="flex items-center gap-2.5 text-[15px] text-ink">
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
					<button type="button" data-testid="homework-assignment-open" onClick={onOpenAssignment} className="lh-btn lh-btn-quiet shrink-0 text-[15px]">
						Open
					</button>
				)}
			</label>
			{error && (
				<p role="alert" data-testid="deadline-start-error" className="text-[15px] text-ans-wrong">
					{error}
				</p>
			)}
			<div className="mt-1">
				<DeadlineKeys deadline={d} busyOn={busyOn} onStudy={onStudy} onWork={onWork} />
			</div>
		</Pane>
	);
});
