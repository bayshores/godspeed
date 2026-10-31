import { useContext, useMemo, type RefObject } from "react";
import type { StickToBottomContext } from "use-stick-to-bottom";
import {
	Conversation,
	ConversationContent,
	ConversationEmptyState,
	ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { BrailleSpinner } from "@/components/braille-spinner";
import { teachStep, useAgentStatus } from "@/components/agent-status";
import { JobsContext } from "@/components/jobs-context";
import { SessionMessageNavigation } from "@/components/session-navigation";
import { useSettingsDialog } from "@/components/settings/settings-dialog-provider";
import type { LhViewMessage, Phase3 } from "@/core";
import { AgentAtWork } from "./agent-at-work";
import { agentWork } from "./agent-at-work-model";
import { ArrivalRow, type Arrive } from "./arrivals";
import { lessonError } from "./lesson-error-model";
import { MessageRow } from "./message-row";

/**
 * THE READING PANE: the lesson as one
 * document in a 640px column at the left of the pane — teacher text at
 * 17/1.6 with CMU headings (.lh-reading in globals.css), answered cards
 * inline. Each message is a memoized row, so streaming redraws only the
 * message being written.
 */
export function ReadingPane({
	messages,
	phases,
	status,
	busy,
	turnInFlight,
	compacting,
	waitingForAgent,
	error,
	onRetry,
	arrivalsLive,
	arrive,
	onOpenPlan,
	scrollContextRef,
}: {
	messages: readonly LhViewMessage[];
	/** The phase at every message (phaseTimeline). */
	phases: readonly Phase3[];
	status: "ready" | "submitted" | "streaming" | "error";
	busy: boolean;
	turnInFlight: boolean;
	compacting: boolean;
	/** The turn waits for an agent to take it: one waiting state instead of Thinking…. */
	waitingForAgent: boolean;
	error: { message: string } | null;
	/** The error banner's Try again. */
	onRetry: () => void;
	arrivalsLive: boolean;
	arrive: Arrive;
	onOpenPlan: () => void;
	scrollContextRef: RefObject<StickToBottomContext | null>;
}) {
	const last = messages.length - 1;
	const jobs = useContext(JobsContext);
	const agentStatusName = useAgentStatus()?.name?.trim();
	const agentName = agentStatusName || "Your agent";
	const { open: openSettings } = useSettingsDialog();
	// The reply being worked on: its plan, steps and file, until its text lands.
	const replying = busy && messages[last]?.role === "assistant" ? messages[last] : undefined;
	const work = useMemo(() => (replying ? agentWork(replying, jobs) : null), [replying, jobs]);
	const showWork = !!work && !work.replied && (work.plan !== null || work.steps.length > 0);
	return (
		// data-halley-area: Halley rests in this pane's bottom corners.
		<Conversation data-halley-area="" className="h-full min-w-0 flex-1" initial="instant" contextRef={scrollContextRef}>
			<SessionMessageNavigation />
			<ConversationContent className="min-h-full gap-0 p-0">
				<div data-session-find-root="" className="lh-reading flex w-full max-w-[744px] flex-1 flex-col gap-4 px-[52px] pt-6 pb-24">
					{messages.length === 0 && !busy && (
						<ConversationEmptyState title="New lesson" description="The teacher will start with a few questions to see what you already know." />
					)}
					{messages.map((m, mi) => (
						<MessageRow
							key={m.id || `m-${mi}`}
							message={m}
							index={mi}
							// The inferred teach seam: teaching begins at the group where
							// the phase fold flips to teach (exactly one per lesson).
							teachSeam={m.role === "assistant" && mi > 0 && phases[mi] === "teach" && phases[mi - 1] !== "teach"}
							streamingLast={status === "streaming" && mi === last}
							hideSteps={showWork && mi === last}
							arrive={arrive}
							onOpenPlan={onOpenPlan}
						/>
					))}
					{/* Compaction holds the model gate: a visible session-wide state,
					    never at the same time as the Thinking placeholder. */}
					{compacting && (
						<ArrivalRow live={arrivalsLive} className="flex items-center gap-2 font-ui text-[13px] font-bold text-ink-3">
							<BrailleSpinner label="Summarizing the lesson" />
							<Shimmer>Summarizing the lesson…</Shimmer>
						</ArrivalRow>
					)}
					{/* From the instant of any action that produces tokens until the
					    turn's first applied event (the stream then renders its own
					    thinking row with the same look). */}
					{showWork && work && (
						<ArrivalRow live={arrivalsLive} as="div">
							<AgentAtWork work={work} agentName={agentName} />
						</ArrivalRow>
					)}
					{waitingForAgent ? (
						<ArrivalRow live={arrivalsLive} as="div" className="flex flex-col items-start gap-1 font-ui text-[13px]">
							<span data-testid="lesson-waiting" className="font-bold text-ink-2">
								Waiting for your agent
							</span>
							<span className="text-ink-3">{teachStep(agentStatusName)}</span>
							<button
								type="button"
								data-testid="lesson-waiting-settings"
								onClick={() => openSettings("connection")}
								className="lh-press mt-1 bg-tone px-2 py-[3px] text-[12.5px] font-bold text-ink-2 hover:text-ink"
							>
								Open Connection settings
							</button>
						</ArrivalRow>
					) : (
						!showWork &&
						(status === "submitted" || turnInFlight) && (
							<ArrivalRow live={arrivalsLive} className="flex items-center gap-2 font-ui text-[13px] font-bold text-ink-3">
								<BrailleSpinner label="Thinking" />
								<Shimmer>Thinking…</Shimmer>
							</ArrivalRow>
						)
					)}
					{error && (
						<ArrivalRow live={arrivalsLive} as="div" className="border border-ans-wrong/50 bg-ans-wrong/10 px-3 py-2 text-sm">
							<span data-testid="lesson-error" title={error.message}>
								{lessonError(error.message).text}
							</span>
							<button
								type="button"
								data-testid="lesson-error-retry"
								onClick={onRetry}
								className="lh-press ml-3 text-foreground underline-offset-2 hover:underline"
							>
								Try again
							</button>
						</ArrivalRow>
					)}
				</div>
			</ConversationContent>
			<ConversationScrollButton className="bottom-6 left-[min(50%,372px)]" />
		</Conversation>
	);
}
