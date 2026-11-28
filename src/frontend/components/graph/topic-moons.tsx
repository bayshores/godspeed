/**
 * A topic's facts as their moons, weakest first: each moon a button that
 * opens its fact, its name in a tag over it while pointed at or focused.
 * The row steps in left to right with its panel.
 */
import { useRef, useState } from "react";
import type { FactProgress } from "@/shared/core";
import { InlineMath } from "@/frontend/components/overview/inline-math";
import { factCellLabel } from "./derive.ts";
import { FactMoon } from "./fact-moon.tsx";
import { MOON_GAP_MS, stepDelay } from "./slip-motion-model.ts";
import { stepIn } from "./use-step-in.ts";

/** The tag's height and its gap over the moon. */
const TAG_ABOVE = 40;

export function TopicMoons({
	facts,
	onOpen,
	size,
	stepFrom,
}: {
	facts: readonly FactProgress[];
	onOpen: (id: string) => void;
	size: number;
	/** When the row starts stepping in, in ms after it mounts; null, it is simply there. */
	stepFrom: number | null;
}) {
	const box = useRef<HTMLDivElement>(null);
	const [tag, setTag] = useState<{ id: string; left: number; top: number; fromRight: boolean } | null>(null);
	const point = (id: string, el: HTMLElement) => {
		const b = box.current?.getBoundingClientRect();
		const r = el.getBoundingClientRect();
		if (!b) return;
		// A moon in the right half hangs its tag leftward, so the tag stays over the panel.
		const fromRight = r.left - b.left > b.width / 2;
		setTag({ id, left: fromRight ? b.right - r.right : r.left - b.left, top: r.top - b.top - TAG_ABOVE, fromRight });
	};
	const pointed = tag && facts.find((f) => f.id === tag.id);
	return (
		<div ref={box} className="relative" onPointerLeave={() => setTag(null)}>
			<ul className="flex flex-wrap gap-1" data-testid="topic-moons">
				{facts.map((f, i) => {
					const step = stepIn(stepFrom === null ? null : stepFrom + stepDelay(i, MOON_GAP_MS));
					return (
						<li key={f.id} className={step.className || undefined} style={step.style}>
							<button
								type="button"
								data-testid="fact-moon"
								aria-label={`${f.name}, ${factCellLabel(f)}`}
								onClick={() => onOpen(f.id)}
								onPointerEnter={(e) => point(f.id, e.currentTarget)}
								onFocus={(e) => point(f.id, e.currentTarget)}
								onBlur={() => setTag(null)}
								className="lh-press block p-[3px] hover:bg-tone"
							>
								<FactMoon fact={f} size={size} />
							</button>
						</li>
					);
				})}
			</ul>
			{pointed && (
				<span
					aria-hidden
					data-testid="fact-moon-tag"
					className="lh-fade lh-sheet pointer-events-none absolute z-40 whitespace-nowrap px-2.5 text-sm leading-7.5 text-ink"
					style={{ top: tag.top, ...(tag.fromRight ? { right: tag.left } : { left: tag.left }) }}
				>
					<InlineMath text={pointed.name} />
				</span>
			)}
		</div>
	);
}
