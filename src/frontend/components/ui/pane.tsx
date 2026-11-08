import { useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/frontend/lib/utils";

/** Panes that appear together draw in one after another, this far apart. */
const STAGGER_MS = 40;
/** A pane mounting within this long of the last one joins its group. */
const GROUP_MS = 100;

let lastMount = -Infinity;
let groupIndex = 0;

/** This pane's place in the group of panes appearing with it. */
function nextDelay(): number {
	const now = performance.now();
	groupIndex = now - lastMount < GROUP_MS ? groupIndex + 1 : 0;
	lastMount = now;
	return groupIndex * STAGGER_MS;
}

/**
 * A pane: a thin border with its name cut into the top edge, the
 * terminal look's one container. The active pane's border and name take
 * the accent. The name sits on the page color, so a pane always sits on
 * the page background. A new pane draws in (globals.css, .lh-pane): its
 * border traces around from the name, then its contents reveal.
 */
export function Pane({
	name,
	active = false,
	className,
	children,
	...rest
}: { name?: ReactNode; active?: boolean; children: ReactNode } & HTMLAttributes<HTMLElement>) {
	// Set before the first paint, outside render: the server's count isn't the window's.
	const ref = useRef<HTMLElement>(null);
	useLayoutEffect(() => {
		ref.current?.style.setProperty("--lh-pane-delay", `${nextDelay()}ms`);
	}, []);
	return (
		<section
			{...rest}
			ref={ref}
			data-active={active || undefined}
			className={cn("lh-pane relative border border-transparent", className)}
		>
			{name && (
				<h2 className={cn("absolute -top-[9px] left-3 z-10 max-w-[calc(100%-24px)] truncate bg-background px-1.5 text-xs leading-4", active ? "font-bold text-tint" : "text-ink-2")}>
					{name}
				</h2>
			)}
			{children}
		</section>
	);
}
