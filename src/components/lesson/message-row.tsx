import { Fragment, memo } from "react";
import dynamic from "next/dynamic";
import { ArrowRightIcon } from "lucide-react";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { LiveToolCard } from "@/components/artifacts/live-tool-card";
import { SubagentSteerCard } from "@/components/artifacts/steer-card";
import { artifactRenderers } from "@/components/artifacts";
import { AnsweredCard } from "@/components/answered-card";
import { PhaseDivider } from "@/components/phase-divider";
import { ThinkingCard, type PracticeThinkingData } from "@/components/practice-cards";
import { ClassContextCard, GraphContextCard, type ClassContextData, type GraphContextData } from "@/components/graph-context-card";
import { CompactionCutDivider, CompactionMomentDivider, type CompactionDividerData } from "@/components/compaction-divider";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
	firstSourceTextParts,
	messageAnchorId,
	teachStepIndex,
	textPartMessageId,
	type ArtifactPartProps,
	type LhViewMessage,
	type LhViewPart,
	type PlanBlockData,
	type QuestionAnswerData,
} from "@/core";
import { STEP_TOOLS } from "./agent-at-work-model";
import type { Arrive } from "./arrivals";
import { isSubagentSteer } from "./chat-helpers";

// A plan diagram (and dagre, its layout engine) loads only for lessons
// that have one; server rendering keeps it in the first paint.
const PlanBlock = dynamic(() => import("@/components/plan-block").then((m) => m.PlanBlock));

/** The quiet system line: centered, muted, small — the transcript's voice
 *  for events that are not speech. */
function SystemLine({ children, testId }: { children: React.ReactNode; testId?: string }) {
	return (
		<div data-testid={testId} className="flex items-center justify-center gap-1.5 py-1 text-xs text-ink-3">
			{children}
		</div>
	);
}

interface MessageRowProps {
	message: LhViewMessage;
	/** The message's position — arrival slots and the step-boundary rule. */
	index: number;
	/** The teaching phase begins at this message (the inferred teach seam). */
	teachSeam: boolean;
	/** This is the last message and its turn is streaming right now. */
	streamingLast: boolean;
	/** The agent-at-work view stands in for this message's step cards. */
	hideSteps: boolean;
	arrive: Arrive;
	onOpenPlan: () => void;
}

/**
 * ONE transcript row: memoized, so while a reply
 * streams only the message being written redraws — every other row keeps
 * its previous message object (reuseUnchangedMessages) and skips.
 */
export const MessageRow = memo(function MessageRow({ message: m, index: mi, teachSeam, streamingLast, hideSteps, arrive, onOpenPlan }: MessageRowProps) {
	if (m.role === "user" && isSubagentSteer(m)) {
		// Sub-agent delivery: no bubble — the artifact card sits in the column.
		return (
			<div className={cn("flex flex-col empty:hidden", arrive(`${mi}`))}>
				<SubagentSteerCard message={m} />
			</div>
		);
	}
	if (m.role === "user" && m.parts.some((p) => p.type === "data-probe-handoff")) {
		// The probe→teach handoff wake: the planning divider IS the seam.
		return (
			<div className={cn("flex flex-col empty:hidden", arrive(`${mi}`))}>
				<PhaseDivider phase="plan" />
			</div>
		);
	}
	if (m.role === "user" && m.parts.length > 0 && m.parts.every((p) => p.type.startsWith("data-"))) {
		// Marker cards (custom messages): user-side scaffolding as cards.
		return (
			<div className={cn("flex flex-col gap-4 empty:hidden", arrive(`${mi}`))}>
				{m.parts.map((part, pi) => <MarkerPart key={pi} part={part} />)}
			</div>
		);
	}
	if (m.role === "user") {
		// The document row: a full-width band with a "You" label, plain text
		// (learner text never goes through the model's LaTeX pipeline).
		return (
			<div
				data-testid="user-message"
				className={cn("my-2 w-full border-l-2 border-tone-2 bg-panel py-2 pl-4 pr-4 font-ui text-sm", arrive(`${mi}`))}
			>
				<div className="text-[13px] font-bold text-ink-3">You</div>
				<div className="lh-prose whitespace-pre-wrap text-ink">
					{m.parts.filter((p) => p.type === "text").map((p) => p.text).join("\n")}
				</div>
			</div>
		);
	}
	// The teach seam's step: -1 = before the whole group; a later index =
	// at that step boundary, replacing its plain hairline.
	const seamStep = teachSeam ? teachStepIndex(m.parts) : null;
	// A native message lives in exactly one view group, so the row can pick
	// its anchors alone.
	const anchors = new Set(firstSourceTextParts([m]).values());
	return (
		<Fragment>
			{seamStep === -1 && <PhaseDivider phase="teach" />}
			<Message from="assistant" className="max-w-full">
				<MessageContent className="w-full">
				{m.parts.map((part, pi) => (
					<AssistantPart
						key={part.type === "text" ? part.id || pi : pi}
						part={part}
						slot={`${mi}:${pi}`}
						first={pi === 0}
						teachBoundary={seamStep === pi}
						anchor={part.type === "text" && part.id && anchors.has(part.id) ? part.id : undefined}
						streaming={streamingLast && pi === m.parts.length - 1}
						hideSteps={hideSteps}
						arrive={arrive}
						onOpenPlan={onOpenPlan}
					/>
				))}
				</MessageContent>
			</Message>
		</Fragment>
	);
});

function MarkerPart({ part }: { part: LhViewPart }) {
	switch (part.type) {
		case "data-graph-context":
			return <GraphContextCard data={part.data as GraphContextData} />;
		case "data-class-context":
			return <ClassContextCard data={part.data as ClassContextData} />;
		case "data-compaction":
			return <CompactionMomentDivider data={part.data as CompactionDividerData} />;
		case "data-compaction-cut":
			return <CompactionCutDivider data={part.data as CompactionDividerData} />;
		case "data-practice-thinking":
			return <ThinkingCard data={part.data as PracticeThinkingData} />;
		case "data-practice-next":
			return (
				<div data-testid="practice-next-line" className="my-4 flex items-center justify-center gap-1.5 font-ui text-xs font-bold text-ink-3">
					<ArrowRightIcon className="size-3" />
					Next problem
				</div>
			);
		default:
			return null;
	}
}

function AssistantPart({
	part,
	slot,
	first,
	teachBoundary,
	anchor,
	streaming,
	hideSteps,
	arrive,
	onOpenPlan,
}: {
	part: LhViewPart;
	slot: string;
	first: boolean;
	teachBoundary: boolean;
	anchor?: string;
	streaming: boolean;
	hideSteps: boolean;
	arrive: Arrive;
	onOpenPlan: () => void;
}) {
	if (hideSteps && STEP_TOOLS.has(part.type.slice("tool-".length))) return null;
	// A tool call that errored BACK TO THE AGENT is invisible work (the agent
	// reads the error and retries): one quiet line. Aborts stay silent.
	if (part.state === "output-error" && part.type.startsWith("tool-") && part.errorText !== "Operation aborted") {
		return (
			<div className={cn("flex flex-col", arrive(slot))}>
				<SystemLine testId="tool-retry">Retrying…</SystemLine>
			</div>
		);
	}
	switch (part.type) {
		case "text": {
			const sourceId = textPartMessageId(part.id);
			return (
				<div
					id={anchor && sourceId ? messageAnchorId(sourceId) : undefined}
					data-source-message-id={sourceId ?? undefined}
					className="lh-source-passage"
				>
					<MessageResponse>{part.text}</MessageResponse>
				</div>
			);
		}
		case "reasoning":
			return (
				<Reasoning isStreaming={streaming} className="mb-2">
					<ReasoningTrigger />
					<ReasoningContent>{part.text ?? ""}</ReasoningContent>
				</Reasoning>
			);
		case "step-start":
			if (teachBoundary)
				return (
					<div className={cn("flex flex-col", arrive(slot))}>
						<PhaseDivider phase="teach" />
					</div>
				);
			return first || hideSteps ? null : <Separator className="my-3" />;
		case "data-plan-block":
			// A frozen snapshot of the plan, rendered as carried.
			return (
				<div className={cn("flex flex-col", arrive(slot))}>
					<PlanBlock data={part.data as PlanBlockData} onOpen={onOpenPlan} />
				</div>
			);
		case "tool-quiz":
		case "tool-probe":
		case "tool-ask_user_question":
		case "tool-explain":
		case "tool-recall":
			// Pending questions live in the Your-turn panel; answered ones
			// render as graded records (the step bar jumps to them).
			if (part.state !== "output-available") return null;
			return (
				<div data-answer-call={part.toolCallId} className={cn("flex scroll-mt-4 flex-col gap-2", arrive(slot))}>
					<AnsweredCard answer={part.output as QuestionAnswerData} input={part.input} />
				</div>
			);
		default: {
			if (!part.type.startsWith("tool-")) return null;
			// A tool call being written: the live card (spinner + activity
			// label). Live and settled cards share one wrapper slot, so the
			// swap never replays the rise.
			if (part.state === "input-streaming") {
				return (
					<div className={cn("flex flex-col", arrive(slot))}>
						<LiveToolCard part={part as ArtifactPartProps["part"]} />
					</div>
				);
			}
			// Artifact extension point (contracts.ts): renderers live in the registry.
			const Renderer = artifactRenderers[part.type.slice("tool-".length)];
			if (!Renderer) return null;
			return (
				<div className={cn("flex flex-col empty:hidden", arrive(slot))}>
					<Renderer part={part as ArtifactPartProps["part"]} />
				</div>
			);
		}
	}
}
