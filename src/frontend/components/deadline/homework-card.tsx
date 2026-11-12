import { memo } from "react";
import type { DeadlineProgress, HomeworkProblem } from "@/shared/core";
import { nextDeadlineButton } from "@/frontend/components/overview/overview-model";
import { SELECT, SELECT_ARROW } from "@/frontend/components/ui/field";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { RULE, SHEET, SHEET_TITLE } from "./styles";

/**
 * A homework or project deadline's problems: the problems themselves (the
 * next one not done is marked), Mark done once it is handed in, the
 * assignment file the teacher reads the problems from, and Work on.
 */
export const HomeworkCard = memo(function HomeworkCard({
	deadline: d,
	problems,
	files,
	assignmentId,
	busy,
	saving,
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
	busy: boolean;
	saving: boolean;
	onWork: () => void;
	onPickAssignment: (fileId: string | null) => void;
	/** Opens the assignment on the desktop; absent in a browser. */
	onOpenAssignment?: () => void;
	onMarkDone: (done: boolean) => void;
}) {
	const next = d.done ? undefined : problems.find((p) => !p.done);
	return (
		<Pane data-testid="homework-card" className={cn(SHEET, "pb-6")}>
			<div className="flex items-center gap-2">
				<h2 className={SHEET_TITLE}>Problems</h2>
				<button type="button" data-testid="homework-mark-done" disabled={saving} onClick={() => onMarkDone(!d.done)} className="lh-btn lh-btn-quiet text-[15px]">
					{d.done ? "Mark not done" : "Mark done"}
				</button>
			</div>
			<span className={RULE} />
			{problems.length > 0 ? (
				<ol data-testid="homework-problems" className="flex flex-col">
					{problems.map((p) => (
						<li key={p.number} data-testid="homework-problem" data-done={p.done || undefined} data-next={p === next || undefined} className="flex min-w-0 items-center gap-3 py-[7px] text-[15px]">
							<span aria-hidden className="flex w-4 shrink-0 justify-center text-ink">
								{p.done ? <PixelIcon name="check" className="h-2" /> : p === next ? <PixelIcon name="play" className="h-3" /> : null}
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
			<span className={RULE} />
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
			{!d.done && (
				<button type="button" data-testid="homework-work" disabled={busy} onClick={onWork} className="lh-btn lh-btn-main mt-1 h-[52px] w-full justify-center gap-2.5 px-[22px] text-[17px]">
					<PixelIcon name="play" />
					<span className="min-w-0 truncate">{nextDeadlineButton(d)}</span>
				</button>
			)}
		</Pane>
	);
});
