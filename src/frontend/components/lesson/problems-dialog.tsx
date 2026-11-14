import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { HomeworkProblem } from "@/shared/core";
import { DialogSheet, useLastWhileClosing } from "@/frontend/components/ui/dialog-sheet";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { ProgressBar } from "@/frontend/components/ui/progress-bar";
import { cn } from "@/frontend/lib/utils";
import { problemTone } from "./plan-row-model";

interface ProblemsView {
	name: string;
	problems: readonly HomeworkProblem[];
	open: string | null;
}

/**
 * The assignment's name over its problems: how many are done, then each
 * problem in order with the done ones ticked and the open one marked.
 */
export function ProblemsDialog({ homework, onClose }: { homework: ProblemsView | null; onClose: () => void }) {
	const { mounted, state, shown } = useLastWhileClosing(homework);
	if (!mounted || !shown) return null;
	return createPortal(<ProblemsSheet homework={shown} state={state} onClose={onClose} />, document.body);
}

function ProblemsSheet({ homework, state, onClose }: { homework: ProblemsView; state: "open" | "closed"; onClose: () => void }) {
	const { name, problems, open } = homework;
	const done = problems.filter((p) => p.done).length;
	const listRef = useRef<HTMLDivElement>(null);
	// A long assignment scrolls; the open problem starts in view.
	useEffect(() => {
		listRef.current?.querySelector('[data-status="current"]')?.scrollIntoView({ block: "nearest" });
	}, []);
	return (
		<DialogSheet title={name} state={state} testid="problems-dialog" onClose={onClose}>
			<div className="flex items-center gap-3">
				<ProgressBar share={done / Math.max(problems.length, 1)} className="w-[360px] max-w-full" />
				<span data-testid="problems-dialog-done" className="shrink-0 font-count text-[15px] text-ink-2">
					{done} of {problems.length} done
				</span>
			</div>
			<div ref={listRef}>
				<ol aria-label="Problems" className="flex flex-col border-y-[1.5px] border-ink">
					{problems.map((p) => (
						<ProblemRow key={p.number} problem={p} open={open} />
					))}
				</ol>
			</div>
		</DialogSheet>
	);
}

/** One problem: a check for a done one, an arrow for the open one, then its number and name. */
function ProblemRow({ problem, open }: { problem: HomeworkProblem; open: string | null }) {
	const tone = problemTone(problem, open);
	return (
		<li data-testid="problem-row" data-status={tone === "later" ? "upcoming" : tone} className={cn("flex items-center gap-3 border-b border-dotted border-edge py-2.5 last:border-b-0", tone === "done" ? "text-ink-2" : "text-ink")}>
			<span aria-hidden className="flex w-[18px] shrink-0 items-center">
				{tone === "done" && <PixelIcon name="check" />}
				{tone === "current" && <PixelIcon name="chevron" />}
			</span>
			<span className="shrink-0 font-count text-lg">{problem.number}</span>
			<span title={problem.title} className="min-w-0 flex-1 truncate text-lg">
				{problem.title}
			</span>
		</li>
	);
}
