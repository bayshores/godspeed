/**
 * A panel's links (the facts a fact builds on and leads to, the topics a
 * topic needs first and leads to): its word, then a chip per link with the
 * link's moon or color square and its name; the whole chip opens it. Chips
 * wrap in one row. A group shows its first `shown` and folds the rest behind
 * an "N more" chip, which opens every group in the panel. The chips step in
 * left to right with their panel; the rest, opened, step in on their own
 * while the ones already shown stay still.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { CHIP_GAP_MS, stepDelay } from "./slip-motion-model.ts";
import { useStepIn } from "./use-step-in.ts";

interface LinkChip {
	id: string;
	/** Full name, for the chip's tooltip. */
	name: string;
	/** What the chip shows; the name when left out. */
	shown?: ReactNode;
	/** The moon or square before the name. */
	mark: ReactNode;
}

const CHIP = "lh-link-chip lh-press flex min-h-8 max-w-full items-center gap-2 py-1 pr-3 pl-1.5 text-left text-[15px] leading-snug";

export function LinkChips({
	label,
	chips,
	shown,
	stepFrom,
	stepsBefore,
	onOpen,
	onMore,
	testid,
	chipTestid,
}: {
	label: string;
	chips: readonly LinkChip[];
	shown: number;
	/** When its row starts stepping in, in ms after it mounts; null, it is simply there. */
	stepFrom: number | null;
	/** The steps of the row before this group (chipSteps of the group to its left). */
	stepsBefore: number;
	onOpen: (id: string) => void;
	onMore: () => void;
	testid: string;
	chipTestid: string;
}) {
	const at = (step: number) => (stepFrom === null ? null : stepFrom + stepDelay(stepsBefore + step, CHIP_GAP_MS));
	const labelStep = useStepIn(at(0));
	// How many chips showed once the group was on screen: one past them joined later ("N more") and steps in alone.
	// Counted a frame after each change, so chips that come and go while the panel is laid out before it is
	// drawn (its links folding, or folding again in another room) still step in with their group.
	const drawn = useRef<number | null>(null);
	useEffect(() => {
		const frame = requestAnimationFrame(() => {
			drawn.current = shown;
		});
		return () => cancelAnimationFrame(frame);
	});
	if (chips.length === 0) return null;
	const before = drawn.current;
	const more = chips.length - shown;
	return (
		<div data-testid={testid} className="flex min-w-0 flex-wrap items-center gap-2">
			<span className={`mr-1 text-base text-ink-2 ${labelStep.className}`} style={labelStep.style}>
				{label}
			</span>
			{chips.slice(0, shown).map((chip, index) => (
				<Chip key={chip.id} delay={before === null ? at(1 + index) : stepDelay(index - before, CHIP_GAP_MS)} testid={chipTestid} title={chip.name} onClick={() => onOpen(chip.id)} className="text-ink">
					{chip.mark}
					<span className="min-w-0">{chip.shown ?? chip.name}</span>
				</Chip>
			))}
			{more > 0 && (
				<Chip delay={at(1 + shown)} testid="links-more" onClick={onMore} className="pl-3 text-ink-2 hover:text-ink">
					{more} more
				</Chip>
			)}
		</div>
	);
}

function Chip({ delay, testid, title, onClick, className, children }: { delay: number | null; testid: string; title?: string; onClick: () => void; className: string; children: ReactNode }) {
	const step = useStepIn(delay);
	return (
		<button type="button" data-testid={testid} onClick={onClick} title={title} className={`${CHIP} ${className} ${step.className}`} style={step.style}>
			{children}
		</button>
	);
}
