import { useEffect, useRef } from "react";
import { cn } from "@/frontend/lib/utils";
import { type ConfidenceLevel } from "@/shared/core";

/**
 * CONFIDENCE, 1–5. The learner picks a level; it is
 * saved as 20/40/60/80/100% (CONFIDENCE_STOPS) so the teacher's prompts,
 * which read percentages, stay unchanged. Old answers (0/30/50/70/90/100)
 * show at their nearest level (confidenceLevel).
 */

/** The confidence ramp (--lh-conf-1…5, globals.css), indexed by
 *  level − 1. */
const CONFIDENCE_COLORS = [
	"var(--lh-conf-1)",
	"var(--lh-conf-2)",
	"var(--lh-conf-3)",
	"var(--lh-conf-4)",
	"var(--lh-conf-5)",
] as const;

/** What each level means, in the learner's words. */
const CONFIDENCE_WORDS: readonly string[] = ["Guessing", "Unsure", "Somewhat sure", "Fairly sure", "Certain"];

/** Roving tabindex: Tab lands on the picked level (the first when
 *  unrated). */
function rovingTabIndex(n: ConfidenceLevel, level: ConfidenceLevel | null): 0 | -1 {
	return n === (level ?? 1) ? 0 : -1;
}

/** When ←/→ change the level (the question panel owns the keys), focus
 *  inside the group follows the pick. */
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
 * "how sure?" over five numbered buttons, each number in its level's
 * color; the picked one fills with it, and its word follows the question
 * ("how sure? fairly sure"). Click one or use ←/→ (the question panel owns
 * the keys). It starts unrated, and an unrated answer sends no
 * confidence. "I don't know" grays it out and sends none either.
 */
export function ConfidenceMeter({
	level,
	onChange,
	disabled = false,
}: {
	level: ConfidenceLevel | null;
	onChange: (level: ConfidenceLevel) => void;
	disabled?: boolean;
}) {
	const groupRef = useFocusFollowsPick<HTMLDivElement>(level);
	return (
		<div data-testid="confidence-meter" className={cn("flex flex-col gap-2", disabled && "opacity-40")}>
			<div data-testid="confidence-value" className="text-xs text-ink-2">
				how sure?
				{level !== null && !disabled && <span style={{ color: CONFIDENCE_COLORS[level - 1] }}>{` ${CONFIDENCE_WORDS[level - 1]!.toLowerCase()}`}</span>}
			</div>
			<div ref={groupRef} className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Confidence">
				{CONFIDENCE_WORDS.map((word, i) => {
					const n = (i + 1) as ConfidenceLevel;
					const color = CONFIDENCE_COLORS[i]!;
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
								"lh-press flex h-8 items-center justify-center border font-mono text-sm tabular-nums transition-colors duration-(--lh-dur-fast) disabled:cursor-default",
								picked ? "font-bold text-background" : "border-tone-2 hover:enabled:bg-tone",
							)}
							style={picked ? { backgroundColor: color, borderColor: color } : { color }}
						>
							{n}
						</button>
					);
				})}
			</div>
		</div>
	);
}

/**
 * The folded form of the meter, for the picked row: "Sure" and five small
 * squares, filled in the level's color up to the pick. Click a square to
 * set the level; unrated, every square is dark. Each square sits in a
 * 24px target (WCAG 2.5.8).
 */
export function ConfidenceSquares({ level, onChange }: { level: ConfidenceLevel | null; onChange: (level: ConfidenceLevel) => void }) {
	const groupRef = useFocusFollowsPick<HTMLSpanElement>(level);
	return (
		<span data-testid="confidence-squares" className="flex shrink-0 items-center gap-2">
			<span className="text-[13px] text-ink-2">Sure</span>
			<span ref={groupRef} className="-mx-[5px] flex" role="radiogroup" aria-label="Confidence">
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
							<span
								aria-hidden
								className={cn("block size-3.5 transition-colors duration-(--lh-dur) ease-(--lh-ease-out)", !on && "bg-edge group-hover:bg-ink-3")}
								style={on ? { backgroundColor: CONFIDENCE_COLORS[level - 1] } : undefined}
							/>
						</button>
					);
				})}
			</span>
		</span>
	);
}
