import { cn } from "@/frontend/lib/utils";

/** A red rubber stamp on something finished ("Done"). One set down just now (`fresh`) prints its rows. */
export function Stamp({ children, fresh }: { children: string; fresh: boolean }) {
	return <span className={cn("inline-block rotate-[8deg] lh-notch border-2 border-stamp px-2.5 py-[5px] text-item leading-none text-stamp", fresh && "lh-print")}>{children}</span>;
}
