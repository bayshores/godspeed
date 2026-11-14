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

/**
 * One quiet line under a quiz's answers once one is picked: "How sure are
 * you?" and five small squares, filled up to the pick, with "Guessing" and
 * "Certain" at the ends when the line has room (each square names its level
 * on hover either way). Click a square, or ←/→ (the question owns the keys).
 * Unrated, every square is light and no confidence is sent. Each square
 * sits in a 24px target (WCAG 2.5.8).
 */
export function ConfidenceLine({ level, onChange, ref }: { level: ConfidenceLevel | null; onChange: (level: ConfidenceLevel) => void; ref?: Ref<HTMLDivElement> }) {
	const groupRef = useRef<HTMLSpanElement>(null);
	// When ←/→ change the level, focus inside the group follows the pick.
	useEffect(() => {
		const group = groupRef.current;
		if (!group || !group.contains(document.activeElement)) return;
		group.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
	}, [level]);
	const end = "hidden shrink-0 text-[13px] text-ink-2 @[24rem]:inline";
	return (
		<div ref={ref} data-testid="confidence-line" className="@container shrink-0">
			<div className="flex items-center gap-2 text-[15px]">
				<span id="confidence-question" className="shrink-0 text-ink-2">
					How sure are you?
				</span>
				<span aria-hidden className={cn(end, "ml-1")}>
					{CONFIDENCE_WORDS[0]}
				</span>
				<span ref={groupRef} className="flex" role="radiogroup" aria-labelledby="confidence-question">
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
								data-testid={`confidence-level-${n}`}
								// Roving tabindex: Tab lands on the picked level (the first when unrated).
								tabIndex={n === (level ?? 1) ? 0 : -1}
								onClick={() => onChange(n)}
								className="group flex size-6 cursor-pointer items-center justify-center"
							>
								<span aria-hidden className={cn("block size-3.5 border-[1.5px] border-ink transition-colors duration-(--lh-dur) ease-(--lh-ease-out)", on ? "bg-ink" : "bg-background group-hover:bg-tone-2")} />
							</button>
						);
					})}
				</span>
				<span aria-hidden className={end}>
					{CONFIDENCE_WORDS[4]}
				</span>
			</div>
		</div>
	);
}
