import { useContext, useState } from "react";
import { blurAfterPointerClick } from "@/frontend/components/focus-hygiene";
import { CARD, SMALL_BTN } from "@/frontend/components/ui/card-parts";
import { ResultTag } from "@/frontend/components/result-tag";
import { proseVars, QuizWhy } from "@/frontend/components/answered-card";
import { ToolContentResponse } from "@/frontend/components/ai-elements/message";
import { ChatActionsContext } from "@/frontend/components/chat-actions-context";
import { CiteDialog } from "@/frontend/components/citations/cite-dialog";
import type { FileCite } from "@/frontend/components/citations/page-excerpt-model";
import { useFold } from "@/frontend/components/use-fold";
import { cn } from "@/frontend/lib/utils";
import { answerForPresentation, citeLabel, confidenceLevel, questionKindLabel, type KeptCardData, type QuestionAnswerData } from "@/shared/core";
import { keptCardView } from "./kept-card-model";
import { useStepNumber } from "./step-context";

/** A quiet word button on the card. */
const QUIET_BTN = "lh-btn lh-btn-quiet h-7 shrink-0 text-[14px]";

/** His sentence as he reads it on a card: Literata 17/28 in ink. */
export function KeptSentence({ text }: { text: string }) {
	return (
		<div data-testid="kept-statement" style={proseVars(17, 28, "var(--foreground)")}>
			<ToolContentResponse>{text}</ToolContentResponse>
		</div>
	);
}

/** The phrase that helps him remember the sentence, in the card's quiet text. */
export function KeptPhrase({ line }: { line: string }) {
	return (
		<div data-testid="kept-phrase" style={proseVars(16, 24, "var(--muted-foreground)")}>
			<ToolContentResponse>{line}</ToolContentResponse>
		</div>
	);
}

/** The space file place a kept sentence came from, underlined; it opens
 *  the page with the words marked. */
export function KeptSource({ cite }: { cite: FileCite }) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button
				type="button"
				data-testid="kept-source"
				onClick={(e) => {
					setOpen(true);
					blurAfterPointerClick(e);
				}}
				className="min-w-0 truncate text-left text-[15px] text-ink underline underline-offset-2 hover:text-ink-max"
			>
				{citeLabel(cite)}
			</button>
			<CiteDialog cite={open ? cite : null} onClose={() => setOpen(false)} />
		</>
	);
}

/**
 * A right answer to a quiz that carried a kept sentence: the sentence, the
 * phrase, the analogy's "fits" and "stops" lines, then the source, the drop
 * or bring back words and Why. Why opens the quiz that earned the sentence,
 * which is where the answered card went.
 */
export function KeptCard({ kept, answer: savedAnswer, input, toolCallId }: { kept: KeptCardData; answer: QuestionAnswerData; input: unknown; toolCallId: string }) {
	const view = keptCardView(kept);
	const actions = useContext(ChatActionsContext);
	const [whyOpen, setWhyOpen] = useState(false);
	const why = useFold(whyOpen);
	const phrase = useFold(view.phrase?.shown ?? false);
	const analogy = useFold(view.analogy?.shown ?? false);
	const step = useStepNumber(input);
	const answer = answerForPresentation(savedAnswer, input);
	const drop = actions?.dropKept;
	return (
		<div data-testid="kept-card" data-kept="" className={cn(CARD, "flex flex-col text-card-foreground")}>
			<KeptSentence text={view.statement} />
			{view.phrase && phrase.mounted && (
				<div className="lh-collapse" data-state={phrase.state}>
					<div>
						<div className="flex items-start gap-2 pt-2.5">
							<div className="min-w-0 flex-1">
								<KeptPhrase line={view.phrase.line} />
							</div>
							{drop && (
								<button type="button" data-testid="kept-drop-phrase" aria-label="Drop this phrase" onClick={() => drop(toolCallId, "phrase", false)} className={QUIET_BTN}>
									Drop this
								</button>
							)}
						</div>
					</div>
				</div>
			)}
			{view.analogy && analogy.mounted && (
				<div className="lh-collapse" data-state={analogy.state}>
					<div data-testid="kept-analogy">
						<div className="pt-2.5" style={proseVars(17, 28, "var(--muted-foreground)")}>
							<ToolContentResponse>{view.analogy.fits}</ToolContentResponse>
						</div>
						<div className="pt-2.5" style={proseVars(17, 28, "var(--muted-foreground)")}>
							<ToolContentResponse>{view.analogy.stops}</ToolContentResponse>
						</div>
					</div>
				</div>
			)}
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-2.5">
				{view.source && <KeptSource cite={view.source} />}
				<span className="flex-1" aria-hidden />
				{drop && view.phrase && !view.phrase.shown && (
					<button type="button" data-testid="kept-bring-phrase" onClick={() => drop(toolCallId, "phrase", true)} className={QUIET_BTN}>
						Bring the phrase back
					</button>
				)}
				{drop && view.analogy && (
					<button type="button" data-testid="kept-analogy-toggle" onClick={() => drop(toolCallId, "analogy", !view.analogy!.shown)} className={QUIET_BTN}>
						{view.analogy.shown ? "Drop this analogy" : "Bring the analogy back"}
					</button>
				)}
				<button
					type="button"
					data-testid="kept-why"
					aria-expanded={whyOpen}
					onClick={(e) => {
						setWhyOpen((v) => !v);
						blurAfterPointerClick(e);
					}}
					className={cn(SMALL_BTN, whyOpen && "[--lh-key:var(--color-tone-2)]")}
				>
					Why
				</button>
			</div>
			{why.mounted && (
				<div className="lh-collapse" data-state={why.state} data-testid="kept-why-details">
					<div className="flex flex-col gap-2 pt-2.5">
						<div className="flex flex-wrap items-center gap-2.5">
							<ResultTag tone="right">Right</ResultTag>
							<span className="font-count text-[15px] text-ink-2">
								{questionKindLabel(answer.tool ?? "quiz", answer.questionType)}
								{step !== undefined && `, step ${step}`}
								{answer.confidence != null && `, sure ${confidenceLevel(answer.confidence)} of 5`}
							</span>
						</div>
						<div style={proseVars(16, 24, "var(--muted-foreground)")}>
							<ToolContentResponse>{answer.questionText}</ToolContentResponse>
						</div>
						<QuizWhy answer={answer} />
					</div>
				</div>
			)}
		</div>
	);
}
