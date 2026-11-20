import { MessageResponse, ToolContentResponse } from "@/frontend/components/ai-elements/message";
import { ResultChip } from "@/frontend/components/answered-card";
import { isPrediction } from "@/frontend/components/answered-card-model";
import { cn } from "@/frontend/lib/utils";
import { fencedCode, type QuestionAnswerData } from "@/shared/core";
import { OptionMark } from "./choice-rows";
import { choiceLetter } from "./problem-choices-model";
import { PICKED, proseVars, QuestionText } from "./question-parts";

/** A choice row as the waiting question draws it, with nothing to press. */
const ROW = "flex w-full items-start gap-3 px-3 py-3.5";

/**
 * The question the learner just answered or skipped, as it stays in "Your
 * turn" while the teacher writes: dimmed and not pressable, with his pick and
 * the verdict beside it. A skip says so instead of a pick; "I don't know" is
 * its verdict alone. The answer is the record the answered card reads.
 */
export function AnsweredTurn({ answer }: { answer: QuestionAnswerData }) {
	const picked = new Set(answer.answers.map((a) => a.index));
	const graded = answer.kind === "quiz" && !isPrediction(answer);
	const options = answer.options ?? [];
	const firstPick = options.find((o) => picked.has(o.index))?.index;
	return (
		<div data-testid="answered-turn" inert className="flex flex-col gap-7">
			<QuestionText quiet>{answer.questionText}</QuestionText>
			{answer.dismissed ? (
				<p data-testid="answered-turn-skipped" className="text-[18px] leading-[28px] text-ink-2">
					Skipped
				</p>
			) : answer.dontKnow ? (
				<div>
					<ResultChip answer={answer} />
				</div>
			) : (
				<>
					{options.length > 0 && (
						<div className="flex flex-col gap-1">
							{options.map((opt, i) => {
								const isPicked = picked.has(opt.index);
								return (
									<div key={opt.index} data-testid="answered-turn-option" data-picked={isPicked || undefined} className={cn(ROW, isPicked && PICKED)}>
										<OptionMark picked={isPicked}>{choiceLetter(i)}</OptionMark>
										<span className="min-w-0 flex-1" style={proseVars(18, 28, true)}>
											<ToolContentResponse>{opt.label}</ToolContentResponse>
										</span>
										{graded && opt.index === firstPick && <ResultChip answer={answer} />}
									</div>
								);
							})}
						</div>
					)}
					{(answer.other ?? answer.text) && (
						<div className="whitespace-pre-wrap border-l-2 border-tone-2 pl-3 text-ink-2" style={proseVars(18, 28, true)}>
							“{answer.other ?? answer.text}”
						</div>
					)}
					{answer.code && <MessageResponse>{fencedCode(answer.code, answer.language ?? "")}</MessageResponse>}
				</>
			)}
		</div>
	);
}
