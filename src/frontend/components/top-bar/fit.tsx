import { cn } from "@/frontend/lib/utils";

/** Words on one line that give their room up: cut short with an ellipsis,
 *  never below `least`. */
export function Fit({ text, least, className }: { text: string; least: string; className?: string }) {
	return (
		<span className={cn("grid", className)}>
			{/* Sizing only: at least `least` wide, at most the whole text. */}
			<span aria-hidden className="invisible [grid-area:1/1]">
				{least}
			</span>
			<span aria-hidden className="invisible h-0 overflow-hidden break-all whitespace-normal [grid-area:1/1]">
				{text}
			</span>
			<span className="w-0 min-w-full truncate [grid-area:1/1]">{text}</span>
		</span>
	);
}
