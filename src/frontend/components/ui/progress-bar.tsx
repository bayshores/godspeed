import { QUARTER_TONE } from "@/frontend/lib/dither";
import { cn } from "@/frontend/lib/utils";

/**
 * How far something is: ink over a dotted track. Decorative: the line
 * beside it says the same in words.
 */
export function ProgressBar({ share, className }: { share: number; className?: string }) {
	return (
		<span aria-hidden className={cn("relative block h-3.5", className)}>
			{/* Two rows of the dots, 4 points from the bar's top and foot. */}
			<span className="absolute inset-x-0 top-1 h-1.5 bg-ink-2" style={QUARTER_TONE} />
			<span className="lh-grow absolute inset-y-0 left-0 bg-ink" style={{ width: `${Math.min(1, Math.max(0, share)) * 100}%` }} />
		</span>
	);
}
