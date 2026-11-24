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
 * One quiet line under a quiz's answers once one is picked: "How sure?",
 * five blocks filled up to the pick, and the picked level in words. The
 * blocks never break apart (each also names its level on hover). Click a
 * block, or ←/→ (the question owns the keys). Unrated, every block is dim
 * and no confidence is sent. Each block sits in a 24px target (WCAG 2.5.8).
 */
export function ConfidenceLine({ level, onChange, ref }: { level: ConfidenceLevel | null; onChange: (level: ConfidenceLevel) => void; ref?: Ref<HTMLDivElement> }) {
	const groupRef = useRef<HTMLSpanElement>(null);
	// When ←/→ change the level, focus inside the group follows the pick.
	useEffect(() => {
		const group = groupRef.current;
		if (!group || !group.contains(document.activeElement)) return;
		group.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
	}, [level]);
	return (
		<div ref={ref} data-testid="confidence-line" className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-base">
			<span id="confidence-question" className="shrink-0 text-ink-2">
				How sure?
			</span>
			<span ref={groupRef} className="flex shrink-0 gap-1" role="radiogroup" aria-labelledby="confidence-question">
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
							className="group flex h-6 w-7 cursor-pointer items-center"
						>
							<span aria-hidden className={cn("block h-4 w-full transition-colors duration-(--lh-dur) ease-(--lh-ease-out)", on ? "bg-ink" : "bg-tone-2 group-hover:bg-ink-3")} />
						</button>
					);
				})}
			</span>
			{/* Reserves its line, so picking a level moves nothing. */}
			<span data-testid="confidence-word" className="min-w-[7.5rem] shrink-0 text-ink-2">
				{level !== null && CONFIDENCE_WORDS[level - 1]}
			</span>
		</div>
	);
}
