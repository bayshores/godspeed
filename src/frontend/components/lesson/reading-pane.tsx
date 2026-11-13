import { useContext, useMemo, type RefObject } from "react";
import type { StickToBottomContext } from "use-stick-to-bottom";
import {
	Conversation,
	ConversationContent,
	ConversationEmptyState,
	ConversationScrollButton,
} from "@/frontend/components/ai-elements/conversation";
import { Shimmer } from "@/frontend/components/ai-elements/shimmer";
import { BrailleSpinner } from "@/frontend/components/braille-spinner";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { JobsContext } from "@/frontend/components/jobs-context";
import { SessionMessageNavigation } from "@/frontend/components/session-navigation";
import type { LhViewMessage, Phase3 } from "@/shared/core";
import { AgentAtWork } from "./agent-at-work";
import { agentWork } from "./agent-at-work-model";
import { ArrivalRow, type Arrive } from "./arrivals";
import { MessageRow } from "./message-row";
import { LABEL_TEXT } from "@/frontend/components/ui/label-text";
import { cn } from "@/frontend/lib/utils";

/**
 * THE READING PANE: the lesson as one document on the reading sheet, in
 * the reading type (.lh-reading in globals.css), answered cards inline.
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
	arrivalsLive,
	pageMarks,
	arrive,
	onOpenPlan,
	scrollContextRef,
}: {
	/** The lesson's space. */
	spaceId: string | undefined;
	messages: readonly LhViewMessage[];
	/** The phase at every message (phaseTimeline). */
	phases: readonly Phase3[];
	status: "ready" | "submitted" | "streaming" | "error";
	busy: boolean;
	turnInFlight: boolean;
	/** The turn waits for an agent to take it: the teacher column says so, and no Thinking… shows. */
	waitingForAgent: boolean;
	arrivalsLive: boolean;
	/** Each Study topic's stored page mark, by the text it sits in. */
	pageMarks: ReadonlyMap<string, string>;
	arrive: Arrive;
	onOpenPlan: () => void;
	scrollContextRef: RefObject<StickToBottomContext | null>;
}) {
	const last = messages.length - 1;
	const jobs = useContext(JobsContext);
	const agentName = useAgentStatus()?.name?.trim() || "Your agent";
	// The reply being worked on: its plan, steps and file, until its text lands.
	const replying = busy && messages[last]?.role === "assistant" ? messages[last] : undefined;
	const work = useMemo(() => (replying ? agentWork(replying, jobs) : null), [replying, jobs]);
	const showWork = !!work && !work.replied && (work.plan !== null || work.steps.length > 0);
	return (
		<Conversation className="min-h-0 min-w-0 flex-1" initial="instant" contextRef={scrollContextRef}>
			<SessionMessageNavigation />
			<ConversationContent className="min-h-full gap-0 p-0">
				<div data-session-find-root="" className="lh-reading flex w-full max-w-[872px] flex-1 flex-col gap-4 px-14 pt-5 pb-24 @max-[640px]/reading:px-7">
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
				</div>
			</ConversationContent>
			<ConversationScrollButton className="bottom-6 left-1/2" />
		</Conversation>
	);
}
