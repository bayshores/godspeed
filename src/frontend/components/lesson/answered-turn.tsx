import { MessageResponse } from "@/frontend/components/ai-elements/message";
import { ResultChip } from "@/frontend/components/answered-card";
import { isPrediction } from "@/frontend/components/answered-card-model";
import { fencedCode, type QuestionAnswerData } from "@/shared/core";
import { ChoiceRows } from "./choice-rows";
import { QuestionText } from "./question-parts";

/**
 * The question the learner just answered or skipped, as it stays in "Your
 * turn" while the teacher writes: as it stood when he sent it, quiet and not
 * pressable, with the verdict on his pick. A skip says so instead of a pick;
 * "I don't know" is its verdict alone. The answer is the record the answered
 * card reads. One answered just now (`fresh`) prints its verdict.
 */
export function AnsweredTurn({ answer, tag, fresh }: { answer: QuestionAnswerData; tag: string | null; fresh: boolean }) {
	const picked = new Set(answer.answers.map((a) => a.index));
	const graded = answer.kind === "quiz" && !isPrediction(answer);
	const options = answer.options ?? [];
	const said = answer.other ?? answer.text;
	return (
		<div data-testid="answered-turn" inert className="flex flex-col gap-7">
			<QuestionText quiet tag={tag}>
				{answer.questionText}
			</QuestionText>
			{answer.dismissed ? (
				<p data-testid="answered-turn-skipped" className="text-tab leading-7 text-ink-2">
					Skipped
				</p>
			) : answer.dontKnow ? (
				<div>
					<ResultChip answer={answer} fresh={fresh} />
				</div>
			) : (
				<>
					{options.length > 0 && (
						<ChoiceRows
							options={options}
							selected={new Set(options.flatMap((opt, i) => (picked.has(opt.index) ? [i] : [])))}
							multi={picked.size > 1}
							verdict={graded && <ResultChip answer={answer} fresh={fresh} />}
						/>
					)}
					{said && <p className="self-start whitespace-pre-wrap lh-well lh-notch px-4 py-2.5 font-prose text-tab leading-7 text-ink-2">{said}</p>}
					{answer.code && <MessageResponse>{fencedCode(answer.code, answer.language ?? "")}</MessageResponse>}
				</>
			)}
		</div>
	);
}
