import { Fragment, memo } from "react";
import { lazyComponent } from "@/frontend/lib/lazy-component";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { paleSpaceColor } from "@/frontend/components/space-color";
import { useSpaceColor } from "@/frontend/components/space-context";
import { Message, MessageContent } from "@/frontend/components/ai-elements/message";
import { CitedResponse } from "@/frontend/components/citations/cited-response";
import { excerptParts } from "@/frontend/components/citations/page-excerpt-model";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/frontend/components/ai-elements/reasoning";
import { LiveToolCard } from "@/frontend/components/artifacts/live-tool-card";
import { SubagentSteerCard } from "@/frontend/components/artifacts/steer-card";
import { artifactRenderers } from "@/frontend/components/artifacts";
import { AnsweredCard } from "@/frontend/components/answered-card";
import { isPrediction } from "@/frontend/components/answered-card-model";
import { PhaseDivider } from "@/frontend/components/phase-divider";
import { ThinkingCard, type PracticeThinkingData } from "@/frontend/components/practice-cards";
import { SpaceContextCard, GraphContextCard, type SpaceContextData, type GraphContextData } from "@/frontend/components/graph-context-card";
import { CompactionCutDivider, CompactionMomentDivider, type CompactionDividerData } from "@/frontend/components/compaction-divider";
import { Separator } from "@/frontend/components/ui/separator";
import { cn } from "@/frontend/lib/utils";
import {
	firstSourceTextParts,
	isAttachmentPart,
	messageAnchorId,
	isQuestionTool,
	teachStepIndex,
	textPartMessageId,
	type ArtifactPartProps,
	type FromEarlierData,
	type KeptCardData,
	type LhViewMessage,
	type LhViewPart,
	type PlanBlockData,
	type QuestionAnswerData,
} from "@/shared/core";
import { STEP_TOOLS } from "./agent-at-work-model";
import type { Arrive } from "./arrivals";
import { isSubagentSteer } from "./chat-helpers";
import { MessageAttachments } from "./message-attachments";
import { drawnSeparators } from "./message-row-model";
import { FromEarlierCard } from "./from-earlier-card";
import { KeptCard } from "./kept-card";
import { LABEL_TEXT } from "@/frontend/components/ui/label-text";

// A plan diagram (and dagre, its layout engine) is its own chunk; the
// lesson loader reads it with the record, so it is in the first paint.
const PlanBlock = lazyComponent(() => import("@/frontend/components/plan-block").then((m) => m.PlanBlock));

/** The quiet system line: centered and muted, the transcript's voice
 *  for events that are not speech. */
function SystemLine({ children, testId }: { children: React.ReactNode; testId?: string }) {
	return (
		<div data-testid={testId} className="flex items-center justify-center gap-1.5 py-1 text-sm text-ink-2">
			{children}
		</div>
	);
}

interface MessageRowProps {
	message: LhViewMessage;
	/** The lesson's space: the learner's bubbles wear its color. */
	spaceId: string | undefined;
	/** The message's position — arrival slots and the step-boundary rule. */
	index: number;
	/** The teaching phase begins at this message (the inferred teach seam). */
	teachSeam: boolean;
	/** This is the last message and its turn is streaming right now. */
	streamingLast: boolean;
	/** The agent-at-work view stands in for this message's step cards. */
	hideSteps: boolean;
	/** Each Study topic's stored page mark, by the text it sits in (topicPageMarks). */
	pageMarks: ReadonlyMap<string, string>;
	arrive: Arrive;
	onOpenPlan: () => void;
}

/**
 * ONE transcript row: memoized, so while a reply
 * streams only the message being written redraws — every other row keeps
 * its previous message object (reuseUnchangedMessages) and skips.
 */
export const MessageRow = memo(function MessageRow({ message: m, spaceId, index: mi, teachSeam, streamingLast, hideSteps, pageMarks, arrive, onOpenPlan }: MessageRowProps) {
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
	if (m.role === "user" && m.parts.some((p) => p.type.startsWith("data-") && !isAttachmentPart(p))) {
		// Marker cards (custom messages): user-side scaffolding as cards; a
		// thinking card's files sit under it.
		return (
			<div className={cn("flex flex-col gap-4 empty:hidden", arrive(`${mi}`))}>
				{m.parts.map((part, pi) => <MarkerPart key={pi} part={part} />)}
				<MessageAttachments parts={m.parts} />
			</div>
		);
	}
	if (m.role === "user") {
		return <UserMessage message={m} spaceId={spaceId} className={arrive(`${mi}`)} />;
	}
	// The teach seam's step: -1 = before the whole group; a later index =
	// at that step boundary, replacing its plain hairline.
	const seamStep = teachSeam ? teachStepIndex(m.parts) : null;
	// A native message lives in exactly one view group, so the row can pick
	// its anchors alone.
	const anchors = new Set(firstSourceTextParts([m]).values());
	const separators = drawnSeparators(m.parts, (part) => partShows(part, hideSteps));
	const pages = excerptParts(m.parts, pageMarks);
	return (
		<Fragment>
			{seamStep === -1 && <PhaseDivider phase="teach" />}
			<Message className="max-w-full">
				<MessageContent className="w-full">
				{m.parts.map((part, pi) => (
					<AssistantPart
						key={part.type === "text" ? part.id || pi : pi}
						part={part}
						slot={`${mi}:${pi}`}
						separator={separators.has(pi)}
						teachBoundary={seamStep === pi}
						anchor={part.type === "text" && part.id && anchors.has(part.id) ? part.id : undefined}
						page={pages.get(pi)}
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

/** The learner's message: a bubble on the right in the lesson's space color.
 *  Plain text, since learner text never goes through the model's LaTeX
 *  pipeline; the learner's files sit under it. */
function UserMessage({ message, spaceId, className }: { message: LhViewMessage; spaceId: string | undefined; className?: string }) {
	const color = useSpaceColor(spaceId);
	const text = message.parts.filter((p) => p.type === "text").map((p) => p.text).join("\n");
	return (
		<div className={cn("my-2 flex w-full justify-end", className)}>
			<div
				data-testid="user-message"
				className="flex w-[520px] max-w-full flex-col gap-2 rounded-sm bg-tone px-3.5 py-2.5"
				style={color ? { background: paleSpaceColor(color) } : undefined}
			>
				{text && <div className="whitespace-pre-wrap font-prose text-ink" style={{ fontSize: "calc(var(--lh-prose-size) - 2px)" }}>{text}</div>}
				<MessageAttachments parts={message.parts} />
			</div>
		</div>
	);
}

function MarkerPart({ part }: { part: LhViewPart }) {
	switch (part.type) {
		case "data-graph-context":
			return <GraphContextCard data={part.data as GraphContextData} />;
		case "data-space-context":
			return <SpaceContextCard data={part.data as SpaceContextData} />;
		case "data-compaction":
			return <CompactionMomentDivider data={part.data as CompactionDividerData} />;
		case "data-compaction-cut":
			return <CompactionCutDivider data={part.data as CompactionDividerData} />;
		case "data-practice-thinking":
			return <ThinkingCard data={part.data as PracticeThinkingData} />;
		case "data-from-earlier":
			return <FromEarlierCard data={part.data as FromEarlierData} />;
		case "data-practice-next":
			return (
				<div data-testid="practice-next-line" className={cn("my-4 flex items-center justify-center gap-2.5", LABEL_TEXT)}>
					<PixelIcon name="chevron" />
					Next problem
				</div>
			);
		default:
			return null;
	}
}

/** Whether AssistantPart draws anything for this part (kept in step with it). */
function partShows(part: LhViewPart, hideSteps: boolean): boolean {
	if (part.type === "text" || part.type === "reasoning" || part.type === "data-plan-block") return true;
	if (!part.type.startsWith("tool-")) return false;
	const tool = part.type.slice("tool-".length);
	if (hideSteps && STEP_TOOLS.has(tool)) return false;
	if (part.state === "output-error" && part.errorText !== "Operation aborted") return true;
	if (isQuestionTool(tool)) return part.state === "output-available";
	return part.state === "input-streaming" || tool in artifactRenderers;
}

function AssistantPart({
	part,
	slot,
	separator,
	teachBoundary,
	anchor,
	page,
	streaming,
	hideSteps,
	arrive,
	onOpenPlan,
}: {
	part: LhViewPart;
	slot: string;
	/** Draw this step-start's hairline (drawnSeparators). */
	separator: boolean;
	teachBoundary: boolean;
	anchor?: string;
	/** The topic's stored page mark this text draws the page of. */
	page?: string;
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
					{/* While it streams, an unclosed diagram fence shows "still drawing", not a doomed parse. */}
					<CitedResponse text={part.text ?? ""} page={page} isAnimating={streaming} className={streaming ? "lh-streaming" : undefined} />
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
			return separator && !hideSteps ? <Separator className="my-3" /> : null;
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
		case "tool-write_code":
			// Pending questions live in the Your-turn panel; answered ones
			// render as graded records (the step bar jumps to them).
			if (part.state !== "output-available") return null;
			return (
				<div data-answer-call={part.toolCallId} className={cn("flex scroll-mt-4 flex-col gap-2", arrive(slot), arrive(slot) && answerFlash(part.output as QuestionAnswerData))}>
					{part.kept ? (
						<KeptCard kept={part.kept as KeptCardData} answer={part.output as QuestionAnswerData} input={part.input} toolCallId={part.toolCallId!} />
					) : (
						<AnsweredCard answer={part.output as QuestionAnswerData} input={part.input} plotValue={part.plotValue as number | undefined} />
					)}
					{part.files && <MessageAttachments parts={part.files} />}
				</div>
			);
		default: {
			if (!part.type.startsWith("tool-")) return null;
			// A tool call being written: the live card (spinner + activity
			// label). Live and settled cards share one wrapper slot, so the
			// swap never replays the rise.
			// A plot being checked draws its own box ("Drawing the plot").
			if (part.state === "input-streaming" && part.type !== "tool-plot") {
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
				<div data-tool-call={part.toolCallId} className={cn("flex flex-col empty:hidden", arrive(slot))}>
					<Renderer part={part as ArtifactPartProps["part"]} />
				</div>
			);
		}
	}
}

/** A just-checked graded answer flashes green or red (globals.css); a
 *  prediction is never marked. */
function answerFlash(answer: QuestionAnswerData): string | undefined {
	if (answer.dontKnow || answer.correct === undefined || isPrediction(answer)) return undefined;
	return answer.correct ? "lh-flash-right" : "lh-flash-wrong";
}
