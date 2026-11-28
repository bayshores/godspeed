import { usePrint } from "@/frontend/components/presence";
import { cn } from "@/frontend/lib/utils";

/** A red rubber stamp on something finished ("Done"). One set down just now (`fresh` as it is first drawn) prints its rows. */
export function Stamp({ children, fresh }: { children: string; fresh: boolean }) {
	const print = usePrint(fresh);
	return (
		<span onAnimationEnd={print.onAnimationEnd} className={cn("inline-block rotate-[8deg] lh-notch border-2 border-stamp px-2.5 py-[5px] text-item leading-none text-stamp", print.className)}>
			{children}
		</span>
	);
}
