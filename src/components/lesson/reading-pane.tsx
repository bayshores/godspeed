import type { RefObject } from "react";
import type { StickToBottomContext } from "use-stick-to-bottom";
import {
	Conversation,
	ConversationContent,
	ConversationEmptyState,
	ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { BrailleSpinner } from "@/components/braille-spinner";
import { SessionMessageNavigation } from "@/components/session-navigation";
import type { LhViewMessage, Phase3 } from "@/core";
import { ArrivalRow, type Arrive } from "./arrivals";
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
	error,
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
	error: { message: string } | null;
	arrivalsLive: boolean;
	arrive: Arrive;
	onOpenPlan: () => void;
	scrollContextRef: RefObject<StickToBottomContext | null>;
}) {
	const last = messages.length - 1;
	return (
		// data-halley-area: Halley rests in this pane's bottom corners.
		<Conversation data-halley-area="" className="h-full min-w-0 flex-1" initial="instant" contextRef={scrollContextRef}>
			<SessionMessageNavigation />
			<ConversationContent className="min-h-full gap-0 p-0">
				<div data-session-find-root="" className="lh-reading flex w-full max-w-[744px] flex-1 flex-col gap-4 px-[52px] pt-6 pb-24">
					{messages.length === 0 && !busy && (
						<ConversationEmptyState title="New lesson" description="The teacher will open by probing what you already know." />
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
							arrive={arrive}
							onOpenPlan={onOpenPlan}
						/>
					))}
					{/* Compaction holds the model gate: a visible session-wide state,
					    never at the same time as the Thinking placeholder. */}
					{compacting && (
						<ArrivalRow live={arrivalsLive} className="flex items-center gap-2 font-ui text-[13px] font-bold text-ink-3">
							<BrailleSpinner label="Compacting context" />
							<Shimmer duration={1}>Compacting context…</Shimmer>
						</ArrivalRow>
					)}
					{/* From the instant of any action that produces tokens until the
					    turn's first applied event (the stream then renders its own
					    thinking row with the same look). */}
					{(status === "submitted" || turnInFlight) && (
						<ArrivalRow live={arrivalsLive} className="flex items-center gap-2 font-ui text-[13px] font-bold text-ink-3">
							<BrailleSpinner label="Thinking" />
							<Shimmer duration={1}>Thinking…</Shimmer>
						</ArrivalRow>
					)}
					{error && (
						<ArrivalRow live={arrivalsLive} as="div" className="border border-ans-wrong/50 bg-ans-wrong/10 px-3 py-2 text-sm">
							Something went wrong: {error.message}
						</ArrivalRow>
					)}
				</div>
			</ConversationContent>
			<ConversationScrollButton className="bottom-6 left-[min(50%,372px)]" />
		</Conversation>
	);
}
