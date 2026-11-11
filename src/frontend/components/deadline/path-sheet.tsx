import { deadlineStudyLabel, hasProblems, rampColor, topicStatus, type DeadlineProgress, type PlanDay } from "@/shared/core";
import { clockLabel, deadlineDateLabel } from "@/frontend/components/class-deadlines-model";
import { Pane } from "@/frontend/components/ui/pane";
import { cn } from "@/frontend/lib/utils";
import { rightLabel, type Material, type TopicTally } from "./deadline-model";
import { RULE, SHEET, SHEET_TITLE } from "./styles";

/**
 * THE PATH TO A DEADLINE: the topics that need work, weakest first, one
 * day at a time, the deadline's own day last, and Study.
 */
export function PathSheet({
	deadline: d,
	plan,
	material,
	tallies,
	past,
	busy,
	startError,
	onStart,
}: {
	deadline: DeadlineProgress;
	plan: readonly PlanDay[];
	material: Material | null;
	tallies: ReadonlyMap<string, TopicTally>;
	/** Due already, and not done. */
	past: boolean;
	busy: boolean;
	/** Why the last Study start failed. */
	startError: string | null;
	onStart: () => void;
}) {
	const ahead = !d.done && !past;
	const allStrong = plan.length === 0 && d.topics.length > 0 && d.topics.every((t) => topicStatus(t.rate) === "strong");
	return (
		<Pane data-testid="deadline-path" className={cn(SHEET, "pb-6")}>
			<h2 className={SHEET_TITLE}>{ahead ? `Path to ${deadlineDateLabel(d.date)}` : "Path"}</h2>
			{ahead && (
				<p data-testid="deadline-path-note" className="text-base text-ink-2">
					{pathNote(d, plan.length > 0, allStrong, material)}
				</p>
			)}
			{ahead && plan.length > 0 && (
				<>
					<span className={RULE} />
					<ol className="flex flex-col">
						{plan.map((day, i) => (
							<li key={day.day} data-testid="deadline-day" className="flex flex-col gap-1 py-1">
								<span className={cn("text-[15px] text-ink", i > 0 && "font-count")}>{i === 0 ? "Today" : deadlineDateLabel(day.day)}</span>
								<ul className="flex flex-col gap-1">
									{day.topics.map((t) => (
										<li key={t.id} className="flex min-w-0 items-center gap-2">
											<span className="size-2.5 shrink-0" style={{ background: rampColor(t.rate) }} aria-hidden />
											<span title={t.name} className="min-w-0 flex-1 truncate text-[15px] text-ink">
												{t.name}
											</span>
											{(tallies.get(t.id)?.answered ?? 0) > 0 && <span className="shrink-0 text-base text-ink-2">{rightLabel(tallies.get(t.id))}</span>}
										</li>
									))}
								</ul>
							</li>
						))}
						<li data-testid="deadline-day-due" className="mt-1.5 flex items-baseline gap-2.5 border-t-2 border-dotted border-edge pt-2.5 text-[15px] text-ink">
							<span className="shrink-0 font-count">{deadlineDateLabel(d.date)}</span>
							<span className="min-w-0 truncate">{d.time ? `${d.name}, ${clockLabel(d.time)}` : d.name}</span>
						</li>
					</ol>
				</>
			)}
			{startError && (
				<p role="alert" data-testid="deadline-start-error" className="text-[15px] text-ans-wrong">
					{startError}
				</p>
			)}
			{ahead && (plan.length > 0 || allStrong) && (
				// A homework's one main button is "Work on" in its Problems sheet.
				<button type="button" data-testid="deadline-start" disabled={busy} onClick={onStart} className={cn("lh-btn mt-1 h-11 w-full justify-center text-[15px]", !hasProblems(d.kind) && "lh-btn-main")}>
					<span className="min-w-0 truncate">{deadlineStudyLabel(d.continueStudy)}</span>
				</button>
			)}
		</Pane>
	);
}

/** The note while the deadline is ahead (the head already says done or past). */
function pathNote(d: DeadlineProgress, hasPlan: boolean, allStrong: boolean, m: Material | null): string {
	if (hasPlan) return d.daysUntil === 0 ? "Due today, so everything that needs work is on today." : "Topics that need work, weakest first.";
	if (allStrong) return "Every topic is strong. Study them to keep it that way.";
	if (d.files.length === 0) return "A plan shows up once it knows what's on it.";
	if (m && m.reading > 0) return "Its files are still being read. The plan shows up once their facts are built.";
	return "Its files have no facts yet, so there is nothing to plan. Course info files never make facts.";
}
