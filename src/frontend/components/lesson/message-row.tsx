import { Fragment, memo, useContext } from "react";
import { FiledCard } from "@/frontend/components/filed-card";
import { ChatActionsContext } from "@/frontend/components/chat-actions-context";
import { Message, MessageContent } from "@/frontend/components/ai-elements/message";
import { excerptParts } from "@/frontend/components/citations/page-excerpt-model";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/frontend/components/ai-elements/reasoning";
import { LiveToolCard } from "@/frontend/components/artifacts/live-tool-card";
import { SubagentSteerCard } from "@/frontend/components/artifacts/steer-card";
import { artifactRenderers } from "@/frontend/components/artifacts";
import { AnsweredCard } from "@/frontend/components/answered-card";
import { isPrediction } from "@/frontend/components/answered-card-model";
import { PhaseDivider } from "@/frontend/components/phase-divider";
import { ThinkingCard, type PracticeThinkingData } from "@/frontend/components/practice-cards";
import { CompactionCutDivider, type CompactionDividerData } from "@/frontend/components/compaction-divider";
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
	type QuestionAnswerData,
} from "@/shared/core";
import type { Arrive } from "./arrivals";
import { isSubagentSteer } from "./chat-helpers";
import { MessageAttachments } from "./message-attachments";
import { drawnSeparators } from "./message-row-model";
import { FromEarlierCard } from "./from-earlier-card";
import { KeptCard } from "./kept-card";
import { ReplyPassage } from "./reply-passage";

interface MessageRowProps {
	message: LhViewMessage;
	/** The message's position — arrival slots and the step-boundary rule. */
	index: number;
	/** The learner's first message only repeats the lesson's title: its words show no bubble. */
	echo: boolean;
	/** The teaching phase begins at this message (the inferred teach seam). */
	teachSeam: boolean;
	/** This is the last message and its turn is streaming right now. */
	streamingLast: boolean;
	/** While the desk shows, the calls its steps stand for, whose cards it hides; null with no desk. */
	hiddenCalls: ReadonlySet<string> | null;
	/** Each Study topic's stored page mark, by the text it sits in (topicPageMarks). */
	pageMarks: ReadonlyMap<string, string>;
	arrive: Arrive;
	/** The parts this row draws, for a reply that runs over two sheets (stepSheets): `from` up to, not including, `to`. All of them when left out. */
	from?: number;
	to?: number;
}

/** Never drawn: the teacher's own scaffolding (space and graph context), read by the desk and the
 *  model, and the learner's go-ahead. */
const UNDRAWN: ReadonlySet<string> = new Set(["data-graph-context", "data-space-context", "data-practice-next"]);

/**
 * Whether MessageRow draws anything for this message (kept in step with it; unsure counts as
 * drawn). The page leaves the lesson text's sheet out while nothing in it is drawn. `inTurn`:
 * the call of the task "Your turn" shows (the open problem, or the task kept beside the text),
 * which is drawn there only.
 */
export function messageShows(m: LhViewMessage, echo: boolean, inTurn: string | null): boolean {
	if (m.role !== "user") return m.parts.some((p) => partShows(p, null) && (inTurn === null || p.toolCallId !== inTurn));
	if (m.parts.every((p) => UNDRAWN.has(p.type))) return false;
	return !(echo && m.parts.every((p) => p.type === "text"));
}

/**
 * ONE transcript row: memoized, so while a reply
 * streams only the message being written redraws — every other row keeps
 * its previous message object (reuseUnchangedMessages) and skips.
 */
export const MessageRow = memo(function MessageRow({ message: m, index: mi, echo, teachSeam, streamingLast, hiddenCalls, pageMarks, arrive, from = 0, to = m.parts.length }: MessageRowProps) {
	const inTurn = useContext(ChatActionsContext)?.inTurn ?? null;
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
	if (m.role === "user" && m.parts.every((p) => UNDRAWN.has(p.type))) {
		// The go-ahead leaves an empty mark the page rests the reply at, its margin taking back the row gap.
		return m.parts.some((p) => p.type === "data-practice-next") ? <div data-testid="go-ahead-mark" className="-mb-4" /> : null;
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
		return <UserMessage message={m} echo={echo} className={arrive(`${mi}`)} />;
	}
	// The teach seam's step: -1 = before the whole group; a later index =
	// at that step boundary, in place of its room.
	const seamStep = teachSeam ? teachStepIndex(m.parts) : null;
	// A native message lives in exactly one view group, so the row can pick
	// its anchors alone.
	const anchors = new Set(firstSourceTextParts([m]).values());
	// A task "Your turn" still shows is not drawn here, so it leaves no room either.
	const separators = drawnSeparators(m.parts, (part) => partShows(part, hiddenCalls) && (inTurn === null || part.toolCallId !== inTurn));
	const pages = excerptParts(m.parts, pageMarks);
	return (
		<Fragment>
			{seamStep === -1 && from === 0 && <PhaseDivider phase="teach" />}
			<Message className="max-w-full">
				<MessageContent className="w-full">
				{m.parts.map((part, pi) => pi >= from && pi < to && (
					<AssistantPart
						key={part.type === "text" ? part.id || pi : pi}
						part={part}
						slot={`${mi}:${pi}`}
						separator={separators.has(pi) && pi > from}
						teachBoundary={seamStep === pi}
						anchor={part.type === "text" && part.id && anchors.has(part.id) ? part.id : undefined}
						page={pages.get(pi)}
						streaming={streamingLast && pi === m.parts.length - 1}
						hiddenCalls={hiddenCalls}
						arrive={arrive}
					/>
				))}
				</MessageContent>
			</Message>
		</Fragment>
	);
});

/** The learner's message: a soft plate at the right, as wide as its words.
 *  Plain text, since learner text never goes through the model's LaTeX
 *  pipeline; the learner's files sit under it. An `echo` of the title shows
 *  only its files. */
function UserMessage({ message, echo, className }: { message: LhViewMessage; echo: boolean; className?: string }) {
	const text = echo ? "" : message.parts.filter((p) => p.type === "text").map((p) => p.text).join("\n");
	if (echo && !message.parts.some(isAttachmentPart)) return null;
	return (
		<div className={cn("my-2 flex w-full justify-end", className)}>
			<div data-testid="user-message" className="flex w-fit max-w-[82%] flex-col gap-2 lh-well px-4 py-2.5">
				{text && <div className="whitespace-pre-wrap font-prose text-ink" style={{ fontSize: "var(--lh-prose-size)" }}>{text}</div>}
				<MessageAttachments parts={message.parts} />
			</div>
		</div>
	);
}

function MarkerPart({ part }: { part: LhViewPart }) {
	switch (part.type) {
		case "data-compaction-cut":
			return <CompactionCutDivider data={part.data as CompactionDividerData} />;
		case "data-practice-thinking":
			return <ThinkingCard data={part.data as PracticeThinkingData} />;
		case "data-from-earlier":
			return <FromEarlierCard data={part.data as FromEarlierData} />;
		default:
			return null;
	}
}

/** The desk shows this tool call as one of its steps. */
const onDesk = (part: LhViewPart, hiddenCalls: ReadonlySet<string> | null): boolean => !!hiddenCalls && !!part.toolCallId && hiddenCalls.has(part.toolCallId);

/** Whether AssistantPart draws anything for this part (kept in step with it). */
function partShows(part: LhViewPart, hiddenCalls: ReadonlySet<string> | null): boolean {
	if (part.type === "text" || part.type === "reasoning") return true;
	if (!part.type.startsWith("tool-")) return false;
	const tool = part.type.slice("tool-".length);
	if (onDesk(part, hiddenCalls)) return false;
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
	hiddenCalls,
	arrive,
}: {
	part: LhViewPart;
	slot: string;
	/** This step-start sits between two replies that both draw (drawnSeparators): room is left there. */
	separator: boolean;
	teachBoundary: boolean;
	anchor?: string;
	/** The topic's stored page mark this text draws the page of. */
	page?: string;
	streaming: boolean;
	hiddenCalls: ReadonlySet<string> | null;
	arrive: Arrive;
}) {
	const inTurn = useContext(ChatActionsContext)?.inTurn ?? null;
	if (onDesk(part, hiddenCalls)) return null;
	// A tool call that errored back to the agent is the agent's own work: it
	// reads the error and tries again, so the lesson shows nothing for it.
	if (part.state === "output-error" && part.type.startsWith("tool-")) return null;
	switch (part.type) {
		case "text": {
			const sourceId = textPartMessageId(part.id);
			return <ReplyPassage id={anchor && sourceId ? messageAnchorId(sourceId) : undefined} sourceId={sourceId ?? undefined} text={part.text ?? ""} page={page} streaming={streaming} />;
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
			return separator && !hiddenCalls ? <div aria-hidden className="h-3" /> : null;
		case "tool-quiz":
		case "tool-probe":
		case "tool-ask_user_question":
		case "tool-explain":
		case "tool-recall":
		case "tool-write_code": {
			// Pending questions live in the Your-turn panel; answered ones
			// render as graded records (the step bar jumps to them).
			if (part.state !== "output-available") return null;
			// Asked while "Your turn" still shows the answer, so the card filed into the text later is no arrival.
			const rise = arrive(slot);
			return (
				<FiledCard away={part.toolCallId === inTurn}>
					<div data-answer-call={part.toolCallId} className={cn("flex scroll-mt-4 flex-col gap-2", rise, rise && answerFlash(part.output as QuestionAnswerData))}>
						{part.kept ? (
							<KeptCard kept={part.kept as KeptCardData} answer={part.output as QuestionAnswerData} input={part.input} toolCallId={part.toolCallId!} />
						) : (
							<AnsweredCard answer={part.output as QuestionAnswerData} input={part.input} plotValue={part.plotValue as number | undefined} />
						)}
						{part.files && <MessageAttachments parts={part.files} />}
					</div>
				</FiledCard>
			);
		}
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
