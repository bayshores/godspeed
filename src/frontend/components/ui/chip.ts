import { cn } from "@/frontend/lib/utils";

/**
 * A chip's fill. A thing to open or remove lies on the well. The highlight marks what is new or in
 * use. The result colors say how an answer or a problem ended, which each background (and a pop-up)
 * makes readable; hints sit midway on the ramp from wrong to right, and plain is the neutral word on
 * a well.
 */
const TONES = {
	well: "lh-well text-ink",
	lit: "bg-highlight text-ink",
	plain: "bg-tone-2 text-ink",
	right: "bg-ans-right text-background",
	hints: "bg-(--lh-ramp-3) text-background",
	wrong: "bg-ans-wrong text-background",
} as const;

export type ChipTone = keyof typeof TONES;

/**
 * A tag is a word that says how the thing beside it stands (Right, New, In use, late), on one line.
 * An item is a thing by its name (a linked fact, a rule, a file), and its name wraps.
 */
const SIZES = {
	tag: "inline-flex h-6 shrink-0 items-center gap-1.5 px-2 text-sm font-medium whitespace-nowrap",
	item: "flex min-h-8 max-w-full items-center gap-2 px-3 py-1 text-left text-ui leading-snug",
} as const;

/**
 * The classes of a chip: a small block cut in the 2-point step, which eases a change of fill.
 * A chip that is a button and opens what it names (`press`) answers the pointer while it can.
 * An item led by a mark or a picture starts closer to its edge, and one that ends in a remove
 * key ends closer to its edge.
 */
export function chip(tone: ChipTone, size: keyof typeof SIZES = "item", { press = false, lead = false, remove = false } = {}): string {
	return cn(
		"lh-notch transition-colors duration-(--lh-dur) ease-(--lh-ease-out)",
		SIZES[size],
		TONES[tone],
		press && "lh-press enabled:hover:bg-tone",
		lead && "pl-1.5",
		remove && "pr-1.5",
	);
}
