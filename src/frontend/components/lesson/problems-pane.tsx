import { memo, useEffect, useRef } from "react";
import { problemLabel, type HomeworkProblem } from "@/shared/core";
import { DoneBar } from "@/frontend/components/ui/done-bar";
import { Pane } from "@/frontend/components/ui/pane";
import { cn } from "@/frontend/lib/utils";

/**
 * A homework lesson's steps pane: the assignment's problems in order with
 * how many are done, done ones ticked, the open one marked and bold.
 */
export const ProblemsPane = memo(function ProblemsPane({ name, problems, open }: { name: string; problems: readonly HomeworkProblem[]; open: string | null }) {
	const done = problems.filter((p) => p.done).length;
	const listRef = useRef<HTMLOListElement>(null);
	// A long assignment scrolls; the open problem stays in view.
	useEffect(() => {
		listRef.current?.querySelector('[data-status="current"]')?.scrollIntoView({ block: "nearest" });
	}, [open]);
	return (
		<Pane name={name.toLowerCase()} data-testid="problems-pane" className="shrink-0 px-3 pt-4 pb-3">
			{problems.length === 0 ? (
				<p data-testid="problems-none" className="px-2 text-sm text-ink-3">
					The teacher is reading the assignment.
				</p>
			) : (
				<>
					<div className="flex items-center gap-3 px-2 pb-2">
						<DoneBar done={done} total={problems.length} className="min-w-0 flex-1" blockClassName="h-2.5 flex-1" />
						<span data-testid="problems-done" className="shrink-0 text-xs text-ink-3 tabular-nums">
							{done} of {problems.length} done
						</span>
					</div>
					<ol ref={listRef} aria-label="Problems" className="flex max-h-[168px] flex-col overflow-y-auto">
						{problems.map((p) => {
							const status = p.done ? "done" : p.number === open ? "current" : "upcoming";
							return (
								<li key={p.number} data-testid="problem-row" data-status={status} className="flex h-6 w-full items-center gap-[1ch] px-2 text-base">
									<span aria-hidden className={cn("w-[1ch] shrink-0", p.done ? "text-ans-right" : "text-tint")}>
										{p.done ? "✓" : status === "current" ? "▸" : " "}
									</span>
									<span className="w-[4ch] shrink-0 text-ink-3 tabular-nums">{problemLabel(p.number)}</span>
									<span
										title={p.title}
										className={cn("min-w-0 flex-1 truncate", p.done && "text-ink-2", status === "current" && "font-bold text-ink", status === "upcoming" && "text-ink-3")}
									>
										{p.title}
									</span>
								</li>
							);
						})}
					</ol>
				</>
			)}
		</Pane>
	);
});
