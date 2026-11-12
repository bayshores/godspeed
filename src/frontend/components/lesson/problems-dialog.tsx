import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { HomeworkProblem } from "@/shared/core";
import { DialogSheet, useLastWhileClosing } from "@/frontend/components/ui/dialog-sheet";
import { ProgressBar } from "@/frontend/components/ui/progress-bar";
import { PlanList, PlanListRow } from "./plan-list";
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
				<PlanList label="Problems">
					{problems.map((p) => {
						const tone = problemTone(p, open);
						return <PlanListRow key={p.number} testid="problem-row" status={tone === "later" ? "upcoming" : tone} tone={tone} number={p.number} name={p.title} />;
					})}
				</PlanList>
			</div>
		</DialogSheet>
	);
}
