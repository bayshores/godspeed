import { useState } from "react";
import { blurAfterPointerClick } from "@/frontend/components/focus-hygiene";
import { CARD, SMALL_BTN } from "@/frontend/components/ui/card-parts";
import { ResultTag } from "@/frontend/components/result-tag";
import { proseVars, QuizWhy } from "@/frontend/components/answered-card";
import { ToolContentResponse } from "@/frontend/components/ai-elements/message";
import { useFold } from "@/frontend/components/use-fold";
import { cn } from "@/frontend/lib/utils";
import type { FromEarlierData, ReviewDetails } from "@/shared/core";
import { fromEarlierRow } from "./from-earlier-card-model";

/** The questions from earlier answered in one sitting: one card, a row
 *  each, under the meta row "From earlier". */
export function FromEarlierCard({ data }: { data: FromEarlierData }) {
	return (
		<div data-testid="from-earlier-card" className={cn(CARD, "flex flex-col gap-2.5 text-card-foreground")}>
			<p className="font-count text-[15px] text-ink-2">From earlier</p>
			<div className="flex flex-col divide-y divide-border">
				{data.rows.map((details) => (
					<Row key={`${details.of.chatId}:${details.of.toolCallId}:${details.answer.answeredAt}`} details={details} />
				))}
			</div>
		</div>
	);
}

/** A right row is one line whose topic words open its Why; a missed row
 *  adds the question and the right answer, and has a Why button. */
function Row({ details }: { details: ReviewDetails }) {
	const row = fromEarlierRow(details);
	const [open, setOpen] = useState(false);
	const fold = useFold(open);
	const toggle = (e: React.MouseEvent) => {
		setOpen((v) => !v);
		blurAfterPointerClick(e);
	};
	return (
		<div data-testid="from-earlier-row" className="flex flex-col gap-2.5 py-3 first:pt-0 last:pb-0">
			<div className="flex flex-wrap items-center gap-2.5">
				<ResultTag tone={row.tone} testId="from-earlier-result">
					{row.word}
				</ResultTag>
				<span className="font-count text-[15px] text-ink-2">
					{row.missed ? (
						row.topic
					) : (
						<button type="button" data-testid="from-earlier-topic" aria-expanded={open} onClick={toggle} className="underline underline-offset-2 hover:text-ink">
							{row.topic}
						</button>
					)}
					{row.sure !== null && `, sure ${row.sure} of 5`}
				</span>
				{row.missed && (
					<>
						<span className="flex-1" aria-hidden />
						<button type="button" data-testid="from-earlier-why" aria-expanded={open} onClick={toggle} className={cn(SMALL_BTN, open && "[--lh-key:var(--color-tone-2)]")}>
							Why
						</button>
					</>
				)}
			</div>
			{row.missed && (
				<>
					<div className="line-clamp-1 text-ink-2" style={proseVars(15, 22, "var(--muted-foreground)")}>
						<ToolContentResponse>{row.question}</ToolContentResponse>
					</div>
					{row.answerLine && (
						<div data-testid="from-earlier-answer" style={proseVars(15, 22, "var(--foreground)")}>
							<ToolContentResponse>{row.answerLine}</ToolContentResponse>
						</div>
					)}
				</>
			)}
			{fold.mounted && (
				<div className="lh-collapse" data-state={fold.state} data-testid="from-earlier-details">
					<div className="flex flex-col gap-2 pt-1">
						<QuizWhy answer={details.answer} />
					</div>
				</div>
			)}
		</div>
	);
}
