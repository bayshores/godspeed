import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/frontend/lib/utils";

/**
 * A sheet: a block of paper on its lip, the app's one container. Its name, when it has one, is its first line.
 */
export function Pane({
	name,
	active = false,
	className,
	children,
	...rest
}: { name?: ReactNode; active?: boolean; children: ReactNode } & HTMLAttributes<HTMLElement>) {
	return (
		<section {...rest} data-active={active || undefined} className={cn("relative lh-sheet", className)}>
			{name && <h2 className="truncate px-4 pt-3 text-lg text-ink">{name}</h2>}
			{children}
		</section>
	);
}
