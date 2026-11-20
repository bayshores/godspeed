import { cn } from "@/frontend/lib/utils";
import { zoomIndex, zoomLabel } from "@/frontend/components/settings/text-size-model";
import { Hint } from "@/frontend/components/ui/hint";
import { useZoom } from "@/frontend/components/use-zoom";
import { barWord } from "./bar-look";

/** The app's size while it is not 100%, so a zoomed window says so. A click puts it back. */
export function BarZoom() {
	const zoom = useZoom();
	if (zoom === 1) return null;
	const size = zoomLabel(zoomIndex(zoom));
	return (
		<Hint label="Back to 100%" side="bottom">
			<button
				type="button"
				data-testid="bar-zoom"
				aria-label={`Text size ${size}, back to 100%`}
				onClick={() => void window.lh?.setZoom?.(1)}
				className={cn(barWord(false), "lh-bar-zoom font-count tabular-nums")}
			>
				{size}
			</button>
		</Hint>
	);
}
