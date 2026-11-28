import { cn } from "@/frontend/lib/utils";
import { zoomLabel } from "@/frontend/lib/camera";
import { Hint } from "@/frontend/components/ui/hint";
import { useLastWhileClosing } from "@/frontend/components/ui/dialog-sheet";
import { useZoom } from "@/frontend/components/use-zoom";
import { useMagnifier } from "@/frontend/components/magnifier/magnifier";
import { barWord } from "./bar-look";

/** How much the page is magnified, or else the app's size, while it is not 100%. A click puts it back.
 *  Back at 100%, it fades out with the last number it showed. */
export function BarZoom() {
	const zoom = useZoom();
	const magnifier = useMagnifier();
	const magnified = magnifier.cam.zoom > 1;
	const held = useLastWhileClosing(magnified || zoom !== 1 ? zoomLabel(magnified ? magnifier.cam.zoom : zoom) : null);
	if (!held.mounted) return null;
	const size = held.shown;
	const closed = held.state === "closed";
	return (
		<Hint label="Back to 100%" side="bottom">
			<button
				type="button"
				data-testid="bar-zoom"
				data-state={closed ? "closed" : undefined}
				inert={closed || undefined}
				aria-label={magnified ? `Magnified ${size}, back to 100%` : `Text size ${size}, back to 100%`}
				onClick={() => (magnified ? magnifier.end() : void window.lh?.setZoom?.(1))}
				className={cn(barWord(false), "lh-bar-zoom font-count tabular-nums", closed && "lh-fade")}
			>
				{size}
			</button>
		</Hint>
	);
}
