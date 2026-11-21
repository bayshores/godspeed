/**
 * A panel's links (the facts a fact builds on and leads to, the topics a
 * topic needs first and leads to): its word, then a chip per link with the
 * link's moon or color square and its name; the whole chip opens it. Chips
 * wrap in one row. A long group shows its first few and folds the rest
 * behind an "N more" chip.
 */
import { useState, type ReactNode } from "react";
import { foldLinks } from "./derive.ts";

interface LinkChip {
	id: string;
	/** Full name, for the chip's tooltip. */
	name: string;
	/** What the chip shows; the name when left out. */
	shown?: ReactNode;
	/** The moon or square before the name. */
	mark: ReactNode;
}

/** Links shown before a group folds. */
const SHOWN = 4;
const CHIP = "lh-link-chip lh-press flex min-h-8 max-w-full items-center gap-2 py-1 pr-3 pl-1.5 text-left text-[15px] leading-snug";

export function LinkChips({ label, chips, onOpen, testid, chipTestid }: { label: string; chips: readonly LinkChip[]; onOpen: (id: string) => void; testid: string; chipTestid: string }) {
	const [open, setOpen] = useState(false);
	if (chips.length === 0) return null;
	const { shown, more } = foldLinks(chips, SHOWN, open);
	return (
		<div data-testid={testid} className="flex min-w-0 flex-wrap items-center gap-2">
			<span className="mr-1 text-base text-ink-2">{label}</span>
			{shown.map((chip) => (
				<button key={chip.id} type="button" data-testid={chipTestid} onClick={() => onOpen(chip.id)} title={chip.name} className={`${CHIP} text-ink`}>
					{chip.mark}
					<span className="min-w-0">{chip.shown ?? chip.name}</span>
				</button>
			))}
			{more > 0 && (
				<button type="button" data-testid="links-more" onClick={() => setOpen(true)} className={`${CHIP} pl-3 text-ink-2 hover:text-ink`}>
					{more} more
				</button>
			)}
		</div>
	);
}
