import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/frontend/lib/utils";

/**
 * A pane: a thin border with its name cut into the top edge, the
 * terminal look's one container. The active pane's border and name take
 * the accent. The name sits on the page color, so a pane always sits on
 * the page background.
 */
export function Pane({
	name,
	active = false,
	className,
	children,
	...rest
}: { name?: ReactNode; active?: boolean; children: ReactNode } & HTMLAttributes<HTMLElement>) {
	return (
		<section {...rest} data-active={active || undefined} className={cn("relative border", active ? "border-tint" : "border-tone-2", className)}>
			{name && (
				<h2 className={cn("absolute -top-[9px] left-3 max-w-[calc(100%-24px)] truncate bg-background px-1.5 text-xs leading-4", active ? "font-bold text-tint" : "text-ink-2")}>
					{name}
				</h2>
			)}
			{children}
		</section>
	);
}
