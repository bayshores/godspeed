import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from "react";
import { BARS } from "@/frontend/components/top-bar/bar-look";
import { cn } from "@/frontend/lib/utils";

/** Where the top bar ends, the line a BarWindow hangs from: one line or two (`--lh-bar-h`), 0 with no bar. */
export function barBottom(): number {
	let bottom = 0;
	for (const bar of document.querySelectorAll(BARS)) bottom = Math.max(bottom, bar.getBoundingClientRect().bottom);
	return bottom;
}

/** Has `observer` see the top bar and the page's words in it change size: a page's words come,
 *  go and change with no window resize. */
export function observeBar(observer: ResizeObserver): void {
	// The bar's second line, in a narrow window, is padding: only the border box grows.
	for (const bar of document.querySelectorAll(BARS)) observer.observe(bar, { box: "border-box" });
}

/**
 * A window hanging from the top bar over the page: the Teacher's, and a lesson plugin's page. It
 * is made of the bar and grows down out of it (.lh-hang), `right` px from the window's right edge.
 * Flush with that edge its right corner is square; with no height it is docked, running to the
 * window's bottom, meeting the bar square and sliding out sideways from what is on its right, the
 * strip (.lh-dock). Both are portaled to the body on open, so the one opened last lies over the
 * other.
 */
export function BarWindow({
	right,
	width,
	height,
	state,
	className,
	children,
	...section
}: {
	right: number;
	width: number;
	height: number | null;
	/** "closed" while it goes back where it came from. */
	state: "open" | "closed";
	className?: string;
	children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"section">, "style" | "className" | "children">) {
	const docked = height === null;
	const corners = docked ? 0 : right === 0 ? "0 0 0 var(--lh-hang-r)" : undefined;
	return (
		<div data-state={state} style={{ right, ...(docked && { "--lh-hang-r": "0px" }) } as CSSProperties} className={cn("lh-hang fixed top-(--lh-bar-h) z-[41]", docked && "lh-dock bottom-0")}>
			<section
				{...section}
				data-state={state}
				style={{ width, height: height ?? "100%", borderRadius: corners }}
				className={cn("lh-popup lh-hang-body relative flex max-h-[calc(100dvh-var(--lh-bar-h))] max-w-[100vw] flex-col overflow-hidden font-ui", className)}
			>
				{children}
			</section>
		</div>
	);
}
