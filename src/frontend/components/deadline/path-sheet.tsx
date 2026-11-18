import { MAIN_KEY } from "@/frontend/components/overview/styles";
import type { ReactNode } from "react";
import { hasProblems, studyLabel, nothingMorePlannedLine, topicStatus, type DeadlineProgress, type PlanDay } from "@/shared/core";
import { clockLabel, deadlineDateLabel } from "@/frontend/components/space-deadlines-model";
import { Pane } from "@/frontend/components/ui/pane";
import { cn } from "@/frontend/lib/utils";
import type { Material, TopicTally } from "./deadline-model";
import { RampRow } from "./ramp-row";

/**
 * THE PATH TO A DEADLINE: the topics that need work, weakest first, one
 * day at a time, the deadline's own day last, Study, then its mocks. An
 * interview with nothing to plan from offers to ask for a study guide.
 */
export function PathSheet({
	deadline: d,
	plan,
	material,
	tallies,
	past,
	busy,
	startError,
	teacherName,
	requesting,
	guideLine,
	onStart,
	onAskGuide,
	mocks,
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
	teacherName: string;
	/** A request to the agent runs on this deadline. */
	requesting: boolean;
	/** Why the last study guide request changed nothing. */
	guideLine: string | null;
	onStart: () => void;
	/** Asks the teacher for a study guide (an interview with nothing to plan from). */
	onAskGuide: () => void;
	/** A test's or interview's mocks (path-mocks.tsx). */
	mocks?: ReactNode;
}) {
	const ahead = !d.done && !past;
	const allStrong = plan.length === 0 && d.topics.length > 0 && d.topics.every((t) => topicStatus(t.rate) === "strong");
	const needsGuide = ahead && d.kind === "interview" && d.topics.length === 0 && !(material && material.reading > 0);
	return (
		<Pane data-testid="deadline-path" className="lh-card">
			<div className="lh-card-head">
				<h2 className="lh-card-title">Path</h2>
			</div>
			{ahead && (
				<p data-testid="deadline-path-note" className="text-base text-ink-2">
					{needsGuide
						? `Nothing is planned yet. A plan needs study files, and the posting only tells ${teacherName} about the interview.`
						: pathNote(d, plan.length > 0, allStrong, material)}
				</p>
			)}
			{needsGuide && (
				<button type="button" data-testid="deadline-ask-guide" disabled={requesting} onClick={onAskGuide} className="lh-btn max-w-full self-end">
					<span className="min-w-0 truncate">Ask {teacherName} for a study guide</span>
				</button>
			)}
			{needsGuide && guideLine && (
				<p role="alert" data-testid="deadline-request-line" className="text-[15px] text-ink">
					{guideLine}
				</p>
			)}
			{ahead && plan.length > 0 && (
				<>
					<ol className="flex flex-col">
						{plan.map((day, i) => (
							<li key={day.day} data-testid="deadline-day" className="flex flex-col gap-1 py-1">
								<span className={cn("text-[15px] text-ink", i > 0 && "font-count")}>{i === 0 ? "Today" : deadlineDateLabel(day.day)}</span>
								{day.topics.length === 0 && (
									<p data-testid="deadline-day-empty" className="text-base text-ink-2">
										{nothingMorePlannedLine()}
									</p>
								)}
								<ul className="flex flex-col gap-1">
									{day.topics.map((t) => (
										<li key={t.id}>
											<RampRow name={t.name} rate={t.rate} tally={tallies.get(t.id)} />
										</li>
									))}
								</ul>
							</li>
						))}
						<li data-testid="deadline-day-due" className="mt-3 flex items-baseline gap-2.5 text-[15px] font-medium text-ink">
							<span className="shrink-0 font-count">{deadlineDateLabel(d.date)}</span>
							<span className="min-w-0 truncate">{d.time ? `${d.name}, ${clockLabel(d.time)}` : d.name}</span>
						</li>
					</ol>
				</>
			)}
			{/* A homework's keys and their error sit in its Problems sheet. */}
			{startError && !hasProblems(d.kind) && (
				<p role="alert" data-testid="deadline-start-error" className="text-[15px] text-ans-wrong">
					{startError}
				</p>
			)}
			{ahead && !hasProblems(d.kind) && (
				<button type="button" data-testid="deadline-start" disabled={busy} onClick={onStart} className={cn(MAIN_KEY, "self-end")}>
					<span className="min-w-0 truncate">{studyLabel(d.continueStudy)}</span>
				</button>
			)}
			{mocks}
		</Pane>
	);
}

/** The note while the deadline is ahead (the head already says done or past). */
function pathNote(d: DeadlineProgress, hasPlan: boolean, allStrong: boolean, m: Material | null): string {
	if (hasPlan) return d.daysUntil === 0 ? "Due today, so everything that needs work is on today." : "Topics that need work, weakest first.";
	if (allStrong) return "Every topic is strong. Study them to keep it that way.";
	if (d.files.length === 0) return "A plan shows up once it knows what's on it.";
	if (m && m.reading > 0) return "Its files are still being read. The plan shows up once their facts are built.";
	return "Its files have no facts yet, so there is nothing to plan. Space info files never make facts.";
}
