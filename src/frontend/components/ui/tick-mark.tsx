import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";

/** The drawn pick box: ticked, half ticked (`mixed`) or empty. Only the look;
 *  the control around it is the page's own. */
export function TickMark({ checked, mixed = false, className }: { checked: boolean; mixed?: boolean; className?: string }) {
	return (
		<span
			aria-hidden
			className={cn("flex size-5 shrink-0 items-center justify-center rounded-sm", checked || mixed ? "bg-tint text-background" : "border-2 border-ink bg-background", className)}
		>
			{checked ? <PixelIcon name="check" className="h-[9px]" /> : mixed && <PixelIcon name="minus" className="h-[9px]" />}
		</span>
	);
}
