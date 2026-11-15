import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from "react";
import { cn } from "@/frontend/lib/utils";

/**
 * A window hanging from the top bar over the page: the Teacher's, and a lesson plugin's page. It
 * is made of the bar and grows down out of it (.lh-hang), `right` px from the window's right edge.
 * Flush with that edge its right corner is square; with no height it is docked, running to the
 * window's bottom and meeting the bar square. Both are portaled to the body on open, so the one
 * opened last lies over the other.
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
	/** "closed" while it goes back up into the bar. */
	state: "open" | "closed";
	className?: string;
	children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"section">, "style" | "className" | "children">) {
	const docked = height === null;
	const corners = docked ? 0 : right === 0 ? "0 0 0 var(--lh-hang-r)" : undefined;
	return (
		<div data-state={state} style={{ right, ...(docked && { "--lh-hang-r": "0px" }) } as CSSProperties} className={cn("lh-hang fixed top-12 z-[41]", docked && "bottom-0")}>
			<section
				{...section}
				data-state={state}
				style={{ width, height: height ?? "100%", borderRadius: corners }}
				className={cn("lh-popup lh-hang-body relative flex max-h-[calc(100dvh-3rem)] max-w-[100vw] flex-col overflow-hidden font-ui", className)}
			>
				{children}
			</section>
		</div>
	);
}
