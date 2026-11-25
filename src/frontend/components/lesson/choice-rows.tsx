import { ToolContentResponse } from "@/frontend/components/ai-elements/message";
import { cn } from "@/frontend/lib/utils";
import { choiceLetter } from "./problem-choices-model";
import { ANSWER_ROW, proseVars } from "./question-parts";

/** A row is a plate 56 tall for one line, as wide as the text. */
const OPTION_ROW = cn(ANSWER_ROW, "lh-choice items-baseline px-4 py-3.5");

/** The picked row is the brightest thing on the page while it can still change: ink for its plate, the page's color for its words. */
const ON_INK = { "--lh-ink-body": "var(--background)", "--lh-ink-strong": "var(--background)", "--lh-ink-italic": "var(--background)" } as React.CSSProperties;

/** Choices this short, and no more than this many, stand side by side. */
const SHORT_LABEL = 12;
const SIDE_BY_SIDE = 4;

/** A choice's letter, the name the teacher and the keyboard call it by; quiet until picked. */
export function OptionMark({ picked, children }: { picked: boolean; children?: React.ReactNode }) {
	return (
		<span aria-hidden className={cn("w-5 shrink-0 font-count text-[17px] leading-7", !picked && "text-ink-2")}>
			{children}
		</span>
	);
}

/** The line under a question whose choices may be several. */
export function SelectAllHint() {
	return <p className="-mt-4 text-[15px] text-ink-2">Select all that apply</p>;
}

/**
 * The lettered rows of a quiz, an ask and a problem with choices, each a plate (short ones side by side): a pick or several
 * (`multi`), the row the keyboard walked on a ring. Which rows are picked and where the
 * keyboard is belong to the caller. Once answered (no `onToggle`) the rows stay as they stood, quiet and
 * not pressable, with a graded answer's `verdict` on the first picked one.
 */
export function ChoiceRows({
	options,
	selected,
	multi,
	walked = null,
	onToggle,
	verdict,
}: {
	options: readonly { label: string; description?: string }[];
	selected: ReadonlySet<number>;
	multi: boolean;
	walked?: number | null;
	onToggle?: (index: number) => void;
	verdict?: React.ReactNode;
}) {
	const firstPicked = options.findIndex((_, i) => selected.has(i));
	const sideBySide = options.length <= SIDE_BY_SIDE && options.every((opt) => opt.label.length <= SHORT_LABEL && !opt.description);
	return (
		<div inert={!onToggle} className={cn("gap-2", sideBySide ? "grid auto-cols-fr grid-flow-col" : "flex flex-col")} role={multi ? "group" : "radiogroup"}>
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
						onClick={() => onToggle?.(i)}
						style={{ "--lh-choice-at": i } as React.CSSProperties}
						className={cn(OPTION_ROW, isSel ? (onToggle ? "bg-ink text-background" : "bg-tone-2") : "lh-well hover:bg-tone", i === walked && !isSel && "ring-2 ring-inset ring-ink-3")}
					>
						<OptionMark picked={isSel && !!onToggle}>{choiceLetter(i)}</OptionMark>
						<span className="min-w-0 flex-1" style={{ ...proseVars(18, 28, !onToggle), ...(isSel && onToggle && ON_INK) }}>
							<ToolContentResponse>{opt.label}</ToolContentResponse>
							{opt.description && (
								<span className="block" style={proseVars(15, 22, true)}>
									<ToolContentResponse>{opt.description}</ToolContentResponse>
								</span>
							)}
						</span>
						{i === firstPicked && verdict}
					</button>
				);
			})}
		</div>
	);
}
