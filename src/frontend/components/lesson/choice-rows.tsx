import { ToolContentResponse } from "@/frontend/components/ai-elements/message";
import { cn } from "@/frontend/lib/utils";
import { choiceLetter } from "./problem-choices-model";
import { ANSWER_ROW, PICKED, proseVars } from "./question-parts";

/** A row is 56 tall for one line, its tone as wide as the sheet's text. */
const OPTION_ROW = cn(ANSWER_ROW, "items-start px-3 py-3.5");

/** A choice's box: its letter, filled once picked. */
export function OptionMark({ picked, children }: { picked: boolean; children?: React.ReactNode }) {
	return (
		<span aria-hidden className={cn("flex size-7 shrink-0 items-center justify-center rounded-[2px] border-[1.5px] border-ink text-sm font-medium", picked ? "bg-ink text-background" : "bg-panel text-ink")}>
			{children}
		</span>
	);
}

/** The line under a question whose choices may be several. */
export function SelectAllHint() {
	return <p className="-mt-4 text-[15px] text-ink-2">Select all that apply</p>;
}

/**
 * The lettered tick rows of a quiz, an ask and a problem with choices: a pick or several
 * (`multi`), the row the keyboard walked on a ring. Which rows are picked and where the
 * keyboard is belong to the caller.
 */
export function ChoiceRows({
	options,
	selected,
	multi,
	walked,
	onToggle,
}: {
	options: readonly { label: string; description?: string }[];
	selected: ReadonlySet<number>;
	multi: boolean;
	walked: number | null;
	onToggle: (index: number) => void;
}) {
	return (
		<div className="flex flex-col gap-1" role={multi ? "group" : "radiogroup"}>
			{options.map((opt, i) => {
				const isSel = selected.has(i);
				return (
					<button
						key={i}
						type="button"
						role={multi ? "checkbox" : "radio"}
						aria-checked={isSel}
						data-kbdrow={i}
						data-testid="question-option"
						onClick={() => onToggle(i)}
						className={cn(OPTION_ROW, isSel ? PICKED : "hover:bg-tone", i === walked && !isSel && "ring-2 ring-inset ring-ink-3")}
					>
						<OptionMark picked={isSel}>{choiceLetter(i)}</OptionMark>
						<span className="min-w-0 flex-1" style={proseVars(18, 28)}>
							<ToolContentResponse>{opt.label}</ToolContentResponse>
							{opt.description && (
								<span className="block" style={proseVars(15, 22, true)}>
									<ToolContentResponse>{opt.description}</ToolContentResponse>
								</span>
							)}
						</span>
					</button>
				);
			})}
		</div>
	);
}
