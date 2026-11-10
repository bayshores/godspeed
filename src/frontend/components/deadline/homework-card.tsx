import { memo } from "react";
import type { DeadlineProgress, HomeworkProblem } from "@/shared/core";
import { CARD, CARD_TITLE } from "@/frontend/components/overview/styles";
import { DoneBar } from "@/frontend/components/ui/done-bar";
import { cn } from "@/frontend/lib/utils";

/**
 * A homework or project deadline's problems: how many are done, Work on
 * (the next problem not done, in a homework session), Mark done once it is
 * handed in, the assignment file the teacher reads the problems from, and
 * the problems themselves.
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
	/** The class's files, for the assignment picker. */
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
	const done = problems.filter((p) => p.done).length;
	const next = problems.find((p) => !p.done);
	return (
		<section data-testid="homework-card" className={CARD}>
			<h2 className={CARD_TITLE}>Problems</h2>
			{problems.length > 0 ? (
				<div className="flex items-center gap-3">
					<DoneBar done={done} total={problems.length} />
					<span data-testid="homework-done" className="text-[13.5px] text-ink-2">
						{done} of {problems.length} problems done
					</span>
				</div>
			) : (
				<p data-testid="homework-none" className="text-[13.5px] leading-5 text-ink-2">
					{assignmentId ? "The teacher lists its problems when you start working on it." : "Pick its assignment file, and the teacher lists its problems when you start working on it."}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				{!d.done && (
					<button type="button" data-testid="homework-work" disabled={busy} onClick={onWork} className="lh-btn lh-btn-main max-w-full">
						<span aria-hidden>▸</span>
						<span className="truncate">work on {d.name.toLowerCase()}</span>
					</button>
				)}
				<button type="button" data-testid="homework-mark-done" disabled={saving} onClick={() => onMarkDone(!d.done)} className="lh-btn">
					{d.done ? "mark not done" : (
						<>
							<span aria-hidden>✓</span> mark done
						</>
					)}
				</button>
			</div>
			<div className="flex w-full items-center gap-3 border-t border-tone-2 pt-3 text-[13.5px]">
				<span className="shrink-0 text-ink-2">Assignment</span>
				<select
					data-testid="homework-assignment"
					aria-label="Assignment file"
					value={assignmentId ?? ""}
					disabled={saving}
					onChange={(e) => onPickAssignment(e.target.value || null)}
					className="min-w-0 flex-1 truncate bg-transparent text-ink outline-none focus-visible:underline"
				>
					<option value="">None picked</option>
					{files.map((f) => (
						<option key={f.id} value={f.id}>
							{f.name}
						</option>
					))}
				</select>
				{assignmentId && onOpenAssignment && (
					<button type="button" data-testid="homework-assignment-open" onClick={onOpenAssignment} className="lh-btn shrink-0">
						open
					</button>
				)}
			</div>
			{problems.length > 0 && (
				<ol data-testid="homework-problems" className="flex w-full flex-col">
					{problems.map((p) => (
						<li key={p.number} data-testid="homework-problem" data-done={p.done || undefined} className="flex min-w-0 items-center gap-[1ch] py-1 text-[14px]">
							<span aria-hidden className={cn("w-[1ch] shrink-0", p.done ? "text-ans-right" : "text-ink-3")}>
								{p.done ? "✓" : p === next ? "▸" : " "}
							</span>
							<span className="w-[4ch] shrink-0 text-ink-2 tabular-nums">{p.number}</span>
							<span title={p.title} className={cn("min-w-0 flex-1 truncate", p === next ? "font-bold text-ink" : "text-ink-2")}>
								{p.title}
							</span>
							{p.done && <span className="shrink-0 text-[12.5px] text-ans-right">right</span>}
						</li>
					))}
				</ol>
			)}
		</section>
	);
});
