import { useContext, useMemo } from "react";
import { ConversationEmptyState } from "@/frontend/components/ai-elements/conversation";
import { Shimmer } from "@/frontend/components/ai-elements/shimmer";
import { BrailleSpinner } from "@/frontend/components/braille-spinner";
import { QueuedSteersBody, type QueuedSteerLine } from "@/frontend/components/queued-steers";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { JobsContext } from "@/frontend/components/jobs-context";
import { DEFAULT_TEACHER_NAME, type LhViewMessage, type Phase3 } from "@/shared/core";
import { AgentAtWork } from "./agent-at-work";
import { agentWork } from "./agent-at-work-model";
import { ArrivalRow, type Arrive } from "./arrivals";
import { GoAheadKey } from "./go-ahead-key";
import { MessageRow } from "./message-row";
import { LABEL_TEXT } from "@/frontend/components/ui/label-text";
import { cn } from "@/frontend/lib/utils";

/**
 * THE READING PANE: the lesson as one document on the lesson text's sheet, in
 * the reading type, answered cards inline. The sheet is as tall as its
 * text; the page around it scrolls (LessonScroll).
 * Its foot holds one thing at a time: while the teacher writes, the lines
 * typed to it that wait for it and Stop; once it has finished, the
 * go-ahead key, if the lesson waits for one.
 * Each message is a memoized row, so streaming redraws only the message
 * being written.
 */
export function ReadingPane({
	spaceId,
	messages,
	phases,
	status,
	busy,
	turnInFlight,
	waitingForAgent,
	onStop,
	goAhead,
	queuedSteers,
	arrivalsLive,
	pageMarks,
	arrive,
	onOpenPlan,
}: {
	/** The lesson's space. */
	spaceId: string | undefined;
	messages: readonly LhViewMessage[];
	/** The phase at every message (phaseTimeline). */
	phases: readonly Phase3[];
	status: "ready" | "submitted" | "streaming" | "error";
	busy: boolean;
	turnInFlight: boolean;
	/** The turn waits for an agent to take it: the pill says so, and no Thinking… shows. */
	waitingForAgent: boolean;
	/** Stops the running turn; null while the teacher reads ahead at a stop, which is not stopped. */
	onStop: (() => void) | null;
	/** The key that moves the lesson on ("Next problem", "Continue", "Start problem 3"); null when none waits. */
	goAhead: { label: string; onGo: () => void } | null;
	/** Lines typed to the teacher that wait for its reply to end. */
	queuedSteers: QueuedSteerLine[];
	arrivalsLive: boolean;
	/** Each Study topic's stored page mark, by the text it sits in. */
	pageMarks: ReadonlyMap<string, string>;
	arrive: Arrive;
	onOpenPlan: () => void;
}) {
	const last = messages.length - 1;
	const jobs = useContext(JobsContext);
	const agentName = useTeacher()?.name ?? DEFAULT_TEACHER_NAME;
	// The reply being worked on: its plan, steps and file, until its text lands.
	const replying = busy && messages[last]?.role === "assistant" ? messages[last] : undefined;
	const work = useMemo(() => (replying ? agentWork(replying, jobs) : null), [replying, jobs]);
	const showWork = !!work && !work.replied && (work.plan !== null || work.steps.length > 0);
	return (
		<div data-session-find-root="" className="flex flex-col gap-4 px-14 pt-10 pb-10 @max-[640px]/column:px-7 @max-[640px]/column:pt-7 @max-[640px]/column:pb-8">
			{messages.length === 0 && !busy && (
				<ConversationEmptyState title="New lesson" description="" />
			)}
			{messages.map((m, mi) => (
				<MessageRow
					key={m.id || `m-${mi}`}
					message={m}
					spaceId={spaceId}
					index={mi}
					// The inferred teach seam: teaching begins at the group where
					// the phase fold flips to teach (exactly one per lesson).
					teachSeam={m.role === "assistant" && mi > 0 && phases[mi] === "teach" && phases[mi - 1] !== "teach"}
					streamingLast={status === "streaming" && mi === last}
					hideSteps={showWork && mi === last}
					pageMarks={pageMarks}
					arrive={arrive}
					onOpenPlan={onOpenPlan}
				/>
			))}
			{/* From the instant of any action that produces tokens until the
			    turn's first applied event (the stream then renders its own
			    thinking row with the same look). */}
			{showWork && work && (
				<ArrivalRow live={arrivalsLive} as="div">
					<AgentAtWork work={work} agentName={agentName} />
				</ArrivalRow>
			)}
			{!waitingForAgent && !showWork && (status === "submitted" || turnInFlight) && (
				<ArrivalRow live={arrivalsLive} className={cn("flex items-center gap-2 font-ui", LABEL_TEXT)}>
					<BrailleSpinner label="Thinking" />
					<Shimmer>Thinking…</Shimmer>
				</ArrivalRow>
			)}
			{busy && onStop && (
				<div className="flex flex-col items-start gap-2 font-ui">
					<QueuedSteersBody steers={queuedSteers} />
					<button type="button" data-testid="stop-turn" onClick={onStop} className="lh-btn lh-btn-quiet">
						Stop
					</button>
				</div>
			)}
			{goAhead && <GoAheadKey label={goAhead.label} onGo={goAhead.onGo} />}
		</div>
	);
}
