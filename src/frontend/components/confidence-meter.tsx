import { type Ref, useEffect, useRef } from "react";
import { cn } from "@/frontend/lib/utils";
import { type ConfidenceLevel } from "@/shared/core";

/**
 * CONFIDENCE, 1–5. The learner picks a level; it is
 * saved as 20/40/60/80/100% (CONFIDENCE_STOPS) so the teacher's prompts,
 * which read percentages, stay unchanged. Old answers (0/30/50/70/90/100)
 * show at their nearest level (confidenceLevel).
 */

/** What each level means, in the learner's words. */
const CONFIDENCE_WORDS: readonly string[] = ["Guessing", "Unsure", "Somewhat sure", "Fairly sure", "Certain"];

/** Roving tabindex: Tab lands on the picked level (the first when
 *  unrated). */
function rovingTabIndex(n: ConfidenceLevel, level: ConfidenceLevel | null): 0 | -1 {
	return n === (level ?? 1) ? 0 : -1;
}

/** When ←/→ change the level (the question's keys), focus inside the
 *  group follows the pick. */
function useFocusFollowsPick<T extends HTMLElement>(level: ConfidenceLevel | null) {
	const ref = useRef<T>(null);
	useEffect(() => {
		const group = ref.current;
		if (!group || !group.contains(document.activeElement)) return;
		group.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
	}, [level]);
	return ref;
}

/**
 * "How sure are you?" over five numbered squares, from "Guessing" to
 * "Certain"; the picked one fills with ink. Click one or use ←/→ (the
 * question owns the keys). It starts unrated, and an unrated answer sends
 * no confidence. "I don't know" grays it out and sends none either.
 */
export function ConfidenceMeter({
	level,
	onChange,
	disabled = false,
	ref,
}: {
	level: ConfidenceLevel | null;
	onChange: (level: ConfidenceLevel) => void;
	disabled?: boolean;
	ref?: Ref<HTMLDivElement>;
}) {
	const groupRef = useFocusFollowsPick<HTMLDivElement>(level);
	return (
		<div ref={ref} data-testid="confidence-meter" className={cn("flex shrink-0 flex-col gap-2", disabled && "opacity-40")}>
			<div id="confidence-question" className="text-[15px] font-medium text-ink">
				How sure are you?
			</div>
			<div ref={groupRef} className="grid grid-cols-5 gap-2" role="radiogroup" aria-labelledby="confidence-question">
				{CONFIDENCE_WORDS.map((word, i) => {
					const n = (i + 1) as ConfidenceLevel;
					const picked = n === level && !disabled;
					return (
						<button
							key={n}
							type="button"
							role="radio"
							aria-checked={n === level}
							aria-label={`${n}, ${word}`}
							data-testid={`confidence-level-${n}`}
							disabled={disabled}
							tabIndex={rovingTabIndex(n, level)}
							onClick={() => onChange(n)}
							className={cn(
								"lh-press flex h-11 items-center justify-center rounded-[2px] border-[1.5px] border-ink text-[15px] font-medium tabular-nums transition-colors duration-(--lh-dur-fast) disabled:cursor-default",
								picked ? "bg-ink text-background" : "bg-background text-ink hover:enabled:bg-tone",
							)}
						>
							{n}
						</button>
					);
				})}
			</div>
			<div aria-hidden className="flex justify-between text-[13px] text-ink-2">
				<span>{CONFIDENCE_WORDS[0]}</span>
				<span>{CONFIDENCE_WORDS[4]}</span>
			</div>
		</div>
	);
}

/**
 * The folded form of the meter, for the picked row: "Sure" and five small
 * squares, filled up to the pick. Click a square to set the level;
 * unrated, every square is light. Each square sits in a 24px target
 * (WCAG 2.5.8).
 */
export function ConfidenceSquares({ level, onChange }: { level: ConfidenceLevel | null; onChange: (level: ConfidenceLevel) => void }) {
	const groupRef = useFocusFollowsPick<HTMLSpanElement>(level);
	return (
		<span data-testid="confidence-squares" className="flex shrink-0 items-center gap-2">
			<span className="text-[15px] text-ink-2">Sure</span>
			<span ref={groupRef} className="-mx-[5px] flex" role="radiogroup" aria-label="How sure are you?">
				{CONFIDENCE_WORDS.map((word, i) => {
					const n = (i + 1) as ConfidenceLevel;
					const on = level !== null && n <= level;
					return (
						<button
							key={n}
							type="button"
							role="radio"
							aria-checked={n === level}
							aria-label={`${n}, ${word}`}
							title={`${n}, ${word}`}
							data-testid={`confidence-square-${n}`}
							tabIndex={rovingTabIndex(n, level)}
							onClick={() => onChange(n)}
							className="group flex size-6 cursor-pointer items-center justify-center"
						>
							<span aria-hidden className={cn("block size-3.5 border-[1.5px] border-ink transition-colors duration-(--lh-dur) ease-(--lh-ease-out)", on ? "bg-ink" : "bg-background group-hover:bg-tone-2")} />
						</button>
					);
				})}
			</span>
		</span>
	);
}
