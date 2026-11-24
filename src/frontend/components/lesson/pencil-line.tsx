import type { CSSProperties } from "react";
import { PixelGrid, PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { inkRows, PENCIL_WORDS, pencilSteps } from "./pencil-line-model";
import type { DeskState } from "./wait-model";

const INK = inkRows(PENCIL_WORDS);
const COLUMNS = INK[0]!.length;
/** One grid pixel of ink, in points. */
const PIXEL = 2;
const SIZE = { "--lh-pencil-w": `${COLUMNS * PIXEL}px`, "--lh-pencil-steps": pencilSteps(COLUMNS) } as CSSProperties;

/**
 * THE PENCIL: the desk's current row before the teacher's first step. A pencil writes a line of
 * handwriting, lifts, and writes it again over the faded line, so the row is never empty once it
 * has written. It lies still, with no ink, while no agent has taken the turn. The motion is in
 * globals.css (.lh-pencil).
 */
export function PencilLine({ state }: { state: DeskState }) {
	return (
		<span aria-hidden data-testid="pencil-line" data-state={state} className="lh-pencil" style={SIZE}>
			{state === "working" && (
				<>
					<PixelGrid rows={INK} className="lh-pencil-ghost h-[18px]" />
					<PixelGrid rows={INK} className="lh-pencil-ink h-[18px]" />
				</>
			)}
			<PixelIcon name="pencil" className="lh-pencil-tip h-[27px]" />
		</span>
	);
}
