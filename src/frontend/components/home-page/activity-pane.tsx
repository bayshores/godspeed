import type { AgentAction } from "@/shared/core";
import { Pane } from "@/frontend/components/ui/pane";
import { cn } from "@/frontend/lib/utils";
import { activityLine, type ActivitySource } from "./home-page-model";

const VERB_COLOR: Record<ActivitySource, string> = { agent: "text-tint", app: "text-ink-2", you: "text-ink" };

/**
 * ACTIVITY (Home): the saved log, newest first: the time, the verb ("read"
 * in the accent for the agent, plain for the app and the learner) and what
 * it was about. A line goes to where it happened, like the teacher's panel.
 */
export function ActivityPane({ actions, nowMs, onGo, className }: { actions: readonly AgentAction[]; nowMs: number; onGo: (a: AgentAction) => void; className?: string }) {
	return (
		<Pane name="activity" data-testid="home-activity" className={cn("relative min-h-[200px]", className)}>
			{actions.length === 0 ? (
				<p data-testid="home-activity-empty" className="px-5 pt-5 text-sm text-ink-2">
					Nothing yet. What your agent reads and saves shows here, and so do your answers.
				</p>
			) : (
				<ul className="flex flex-col px-3 pt-4 pb-3 @5xl:absolute @5xl:inset-0 @5xl:overflow-y-auto">
					{actions.map((a) => {
						const line = activityLine(a, nowMs);
						return (
							<li key={a.id}>
								<button
									type="button"
									data-testid="home-activity-line"
									disabled={a.removed}
									onClick={() => onGo(a)}
									className="flex h-[25px] w-full items-baseline gap-3 px-2 text-left text-sm hover:bg-tone disabled:hover:bg-transparent"
								>
									<span className="w-[6ch] shrink-0 text-ink-3 tabular-nums">{line.time}</span>
									<span className={cn("w-[10ch] shrink-0 truncate", VERB_COLOR[line.source])}>{line.verb}</span>
									<span title={line.rest} className="min-w-0 flex-1 truncate font-[family-name:var(--font-prose)] text-ink">
										{line.rest}
									</span>
								</button>
							</li>
						);
					})}
				</ul>
			)}
		</Pane>
	);
}
