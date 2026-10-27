import { useEffect, useRef, useState } from "react";
import { LightbulbIcon } from "lucide-react";
import { PracticeDock } from "@/components/practice-dock";
import { QuestionDock, questionKindLabel, type QuestionDockProps } from "@/components/question-dock";
import { ReadingThinkingField } from "@/components/reading-thinking";
import type { QueuedSteerLine } from "@/components/queued-steers";
import type { findPendingToolCall, QuestionAnswerData, QuestionFormDraft } from "@/src/core";
import { revealArrival } from "./chat-helpers";
import { PanelComposer } from "./panel-composer";
import { ActionBar, KindChip, PanelBody, PanelHeader } from "./panel-parts";

type Pending = NonNullable<ReturnType<typeof findPendingToolCall>>;

/**
 * THE YOUR-TURN PANEL (redesign, lesson layout B): always on the right
 * (440px), below the text in narrow windows. What it holds, in order:
 * - a teach-phase check waiting behind "Check your understanding" (the
 *   learner reads first, can note thoughts while reading, then opens it);
 * - a waiting question (QuestionDock);
 * - an active practice problem (PracticeDock);
 * - otherwise the message box (PanelComposer).
 * The lesson's stats row sits at the foot of every state.
 */
export function YourTurnPanel({
	pending,
	requiresReveal,
	initialQuestionDraft,
	onSaveQuestionDraft,
	onSubmitAnswer,
	readingThinking,
	onReadingThinking,
	practice,
	practiceNumber,
	onSubmitThinking,
	compacting,
	composer,
	stats,
}: {
	pending: Pending | null;
	/** A teach-phase check: it waits behind the reveal invitation. */
	requiresReveal: boolean;
	initialQuestionDraft?: QuestionFormDraft;
	onSaveQuestionDraft: (draft: QuestionFormDraft) => void;
	onSubmitAnswer: (output: QuestionAnswerData) => void;
	readingThinking: string;
	onReadingThinking: (v: string) => void;
	practice: { toolCallId: string; input: unknown } | null;
	practiceNumber: number | null;
	onSubmitThinking: (text: string) => void;
	compacting: boolean;
	/** The message-box state's props (everything but the stats footer). */
	composer: Omit<React.ComponentProps<typeof PanelComposer>, "footer">;
	stats: React.ReactNode;
}) {
	// The reveal: false until the learner opens the check. Reset during
	// render when a new question lands — open at once only when it follows
	// another question (the reading already happened).
	const pendingId = pending?.toolCallId ?? null;
	const [revealed, setRevealed] = useState(false);
	const prevPendingIdRef = useRef(pendingId);
	if (pendingId !== prevPendingIdRef.current) {
		const wasQuestion = prevPendingIdRef.current !== null;
		prevPendingIdRef.current = pendingId;
		if (pendingId && requiresReveal) setRevealed(revealArrival(wasQuestion).revealed);
	}
	const revealPending = pending !== null && requiresReveal && !revealed;
	const revealRef = useRef(() => setRevealed(true));

	// Enter opens the waiting check from anywhere a typing surface or a
	// button doesn't own it (owner, keyboard round 2026-10-06).
	useEffect(() => {
		if (!revealPending) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Enter" || e.altKey) return;
			if (e.shiftKey && !e.metaKey && !e.ctrlKey) return;
			const t = e.target as HTMLElement | null;
			if (t && ((t.tagName === "INPUT" && (t as HTMLInputElement).type !== "range") || t.tagName === "TEXTAREA" || t.isContentEditable || t.closest("button"))) return;
			e.preventDefault();
			revealRef.current();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [revealPending]);

	const mode = revealPending ? `reveal:${pendingId}` : pending ? `question:${pendingId}` : practice ? `practice:${practice.toolCallId}` : "chat";
	// The opening state appears still; later states rise in.
	const initialModeRef = useRef(mode);
	const footer = <div className="shrink-0 pt-3">{stats}</div>;

	let body: React.ReactNode;
	if (pending && revealPending) {
		const label = questionKindLabel(pending.tool as QuestionDockProps["toolName"], pending.input);
		body = (
			<div className="flex min-h-0 flex-1 flex-col">
				<PanelBody>
					<PanelHeader
						eyebrow="Your turn"
						right={
							<KindChip>
								{label === "Prediction" && <LightbulbIcon aria-hidden className="size-3.5" />}
								{label}
							</KindChip>
						}
					/>
					<div className="mt-3 flex min-h-0 flex-1 flex-col">
						<ReadingThinkingField value={readingThinking} onChange={onReadingThinking} onOpen={() => revealRef.current()} />
					</div>
					{footer}
				</PanelBody>
				<ActionBar testId="teach-check-reveal" label="Check your understanding" onClick={() => revealRef.current()} />
			</div>
		);
	} else if (pending) {
		body = (
			<QuestionDock
				toolName={pending.tool as QuestionDockProps["toolName"]}
				toolCallId={pending.toolCallId}
				input={pending.input as never}
				onSubmit={onSubmitAnswer}
				initialDraft={initialQuestionDraft}
				onSaveDraft={onSaveQuestionDraft}
				compactionRunning={compacting}
				footer={footer}
			/>
		);
	} else if (practice) {
		body = (
			<PracticeDock
				problemCallId={practice.toolCallId}
				input={practice.input as { statement: string }}
				number={practiceNumber}
				onSubmit={onSubmitThinking}
				compactionRunning={compacting}
				footer={footer}
			/>
		);
	} else {
		body = <PanelComposer {...composer} footer={footer} />;
	}

	return (
		<aside
			data-testid="your-turn-panel"
			data-mode={mode.split(":")[0]}
			className="flex min-h-0 w-full shrink-0 flex-col border-t border-tone-2 bg-panel max-[1099px]:max-h-[55dvh] max-[1099px]:min-h-[280px] min-[1100px]:w-[440px] min-[1100px]:border-t-0 min-[1100px]:border-l"
		>
			<div key={mode} className={`flex min-h-0 flex-1 flex-col${mode === initialModeRef.current ? "" : " lh-rise"}`}>
				{body}
			</div>
		</aside>
	);
}
