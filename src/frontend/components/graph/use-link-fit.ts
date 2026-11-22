/**
 * How many of a panel's links show at rest: as many as let the panel fit its
 * room whole, so nothing in it is cut; the rest wait behind an "N more" chip.
 * Opening them shows all, and the panel's middle scrolls past its greatest
 * height. Fitted before paint, one link fewer at a time, and again from all
 * when the room changes. With every link folded the name and words may grow
 * the panel to its greatest height; one taller still says so, and shows alone.
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { PanelMotion } from "./slip-motion-model.ts";

/** The room a panel fits at rest, and how it came into it. */
export interface PanelRoom {
	/** One column, for a narrow room. */
	stacked: boolean;
	width: number;
	/** The height the links fold to fit under. */
	height: number;
	/** The greatest height, which only the name and words may grow the panel to. */
	most: number;
	/** Only in the slip: the panel is taller than its greatest height even with every link folded. */
	onTooTall?: () => void;
	/** How the panel came, which says what of it steps in. */
	motion: PanelMotion;
}

export function useLinkFit(total: number, room: PanelRoom) {
	const box = useRef<HTMLElement>(null);
	const middle = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const [fit, setFit] = useState({ total, width: room.width, height: room.height, shown: total });
	if (fit.total !== total || fit.width !== room.width || fit.height !== room.height) setFit({ total, width: room.width, height: room.height, shown: total });
	useLayoutEffect(() => {
		const panel = box.current;
		const words = middle.current;
		if (open || !panel || !words || room.height <= 0) return;
		// The panel's own height, plus what its scrolling middle hides.
		const needs = panel.offsetHeight + Math.max(0, words.scrollHeight - words.clientHeight || 0);
		if (!(needs > room.height)) return;
		if (fit.shown > 0) setFit((f) => ({ ...f, shown: f.shown - 1 }));
		else if (needs > room.most) room.onTooTall?.();
	});
	return { box, middle, shown: open ? total : Math.min(fit.shown, total), openAll: () => setOpen(true) };
}
