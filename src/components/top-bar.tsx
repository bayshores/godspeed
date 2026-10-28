/**
 * THE TOP BAR: one element, every surface — the same mechanics ALWAYS.
 * Whenever a surface has a top bar, it renders THIS component — never a
 * bespoke header (hand-rolled bars got the height, title size, drag
 * region and traffic-light gutter wrong).
 *
 * Mechanics baked in:
 * - h-15 (60px) — matches the sidebar's wordmark band. No bottom border
 *   line.
 * - lh-drag — the window-drag band. NATIVE interactive children
 *   (button/input/a/…) carve out AUTOMATICALLY via the globals.css auto
 *   carve-out rule — "draggable anywhere that is not a clickable element"
 *   is structural, not per-child discipline; manual lh-no-drag is only
 *   for clickable non-natives (spans/divs with onClick).
 * - select-none — dragging never highlights the title.
 * - SidebarToggle FIRST — the sidebar reopen when closed, with its
 *   Electron traffic-light gutter (lh-closed-toggle).
 * - px-3, gap-3 rhythm.
 *
 * The consumer brings the title (font-title text-3xl tracking-tight) and
 * any right-side controls. THE TITLE LAW: the serif title ALWAYS names a
 * session — chrome-less creation surfaces (Home) and the chain table
 * render NO serif title.
 * `drag={false}` is the one escape hatch —
 * chat's rename mode (app-region:drag would eat the mousedown that
 * exits the input).
 *
 * THE OVERLAY TWIN OF THE MASK LAW: app-region subtraction resolves by
 * DOM order, not z-index — a surface containing a TopBar that COVERS
 * other content (a full-bleed overlay) must be the LAST child of its
 * container, or later no-drag elements punch dead zones through the bar.
 */

import type { ReactNode } from "react";
import { SidebarToggle } from "@/components/sidebar";
import { FollowChip } from "@/components/halley/follow-chip";

export function TopBar({
	drag = true,
	onMouseDown,
	children,
}: {
	drag?: boolean;
	onMouseDown?: React.MouseEventHandler<HTMLElement>;
	children?: ReactNode;
}) {
	return (
		<header
			onMouseDown={onMouseDown}
			className={`${drag ? "lh-drag " : ""}lh-wco-gutter flex h-15 select-none items-center gap-3 px-3`}
		>
			<SidebarToggle />
			{/* 28px from the edge, like the page titles (px-3 + 16). */}
			<FollowChip className="ml-4" />
			{children}
		</header>
	);
}
