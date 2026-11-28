import type { CSSProperties } from "react";
import { PixelGrid, PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { inkRows, PENCIL_WORDS, pencilSteps } from "./pencil-line-model";

const INK = inkRows(PENCIL_WORDS);
const COLUMNS = INK[0]!.length;
/** One grid pixel of ink, in points. */
const PIXEL = 2;
const SIZE = { "--lh-pencil-w": `${COLUMNS * PIXEL}px`, "--lh-pencil-steps": pencilSteps(COLUMNS) } as CSSProperties;

/**
 * THE PENCIL: the desk's current row before the teacher's first step. A pencil writes a line of
 * handwriting, lifts, and writes it again over the faded line, so the row is never empty once it
 * has written. The motion is in globals.css (.lh-pencil).
 */
export function PencilLine() {
	return (
		<span aria-hidden data-testid="pencil-line" className="lh-pencil" style={SIZE}>
			<PixelGrid rows={INK} size={INK.length * PIXEL} className="lh-pencil-ghost" />
			<PixelGrid rows={INK} size={INK.length * PIXEL} className="lh-pencil-ink" />
			<PixelIcon name="pencil" size={27} className="lh-pencil-tip" />
		</span>
	);
}
