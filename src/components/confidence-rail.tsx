import { cn } from "@/lib/utils";
import { type ConfidenceLevel } from "@/core";

/**
 * CONFIDENCE, 1–5 (redesign 2026-10-27). The learner picks a level; it is
 * saved as 20/40/60/80/100% (CONFIDENCE_STOPS) so the teacher's prompts,
 * which read percentages, stay unchanged. Old answers (0/30/50/70/90/100)
 * show at their nearest level (confidenceLevel).
 */

/** The confidence ramp, level 1 red → level 5 emerald (Tailwind; the
 *  conf-1…5 tokens in globals.css), indexed by level − 1. */
const CONFIDENCE_COLORS: readonly string[] = ["#EF4444", "#F97316", "#EAB308", "#84CC16", "#10B981"];

/** What each level means, in the learner's words. */
const CONFIDENCE_WORDS: readonly string[] = ["Guessing", "Unsure", "Somewhat sure", "Fairly sure", "Certain"];

/** Bar heights (px), rising with the level. */
const BAR_HEIGHTS = [14, 21, 28, 35, 42];

/**
 * The 5-bar meter: "4 · Fairly sure" in the level's color over five
 * rising bars. Bars up to the pick wear its color (the ones below at 55%),
 * the rest stay dark. Click a bar or use ←/→ (the question panel owns the
 * keys). "I don't know" grays it out and sends no confidence.
 */
export function ConfidenceMeter({
	level,
	onChange,
	disabled = false,
}: {
	level: ConfidenceLevel;
	onChange: (level: ConfidenceLevel) => void;
	disabled?: boolean;
}) {
	const color = CONFIDENCE_COLORS[level - 1]!;
	return (
		<div data-testid="confidence-meter" className={cn("flex flex-col gap-2", disabled && "opacity-40")}>
			<div
				data-testid="confidence-value"
				className="text-[13.5px] font-bold"
				style={{ color: disabled ? "var(--color-ink-3)" : color }}
			>
				{`${level} · ${CONFIDENCE_WORDS[level - 1]}`}
			</div>
			<div className="flex items-end gap-[3px]" role="radiogroup" aria-label="Confidence">
				{BAR_HEIGHTS.map((h, i) => {
					const n = (i + 1) as ConfidenceLevel;
					const on = !disabled && n <= level;
					return (
						<button
							key={n}
							type="button"
							role="radio"
							aria-checked={n === level}
							aria-label={`${n} · ${CONFIDENCE_WORDS[i]}`}
							data-testid={`confidence-level-${n}`}
							disabled={disabled}
							tabIndex={-1}
							onClick={() => onChange(n)}
							className="group flex flex-1 cursor-pointer flex-col items-center gap-[5px] outline-none disabled:cursor-default"
						>
							<span
								aria-hidden
								className={cn(
									"block w-full transition-[background-color,opacity] duration-(--lh-dur) ease-(--lh-ease-out)",
									!on && "bg-tone-2 group-hover:group-enabled:bg-ink-3",
								)}
								style={{ height: h, ...(on ? { backgroundColor: color, opacity: n === level ? 1 : 0.55 } : {}) }}
							/>
							<span
								aria-hidden
								className={cn(
									"font-mono text-[12.5px] tabular-nums",
									n === level && !disabled ? "font-bold text-ink" : "text-ink-3",
								)}
							>
								{n}
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}
