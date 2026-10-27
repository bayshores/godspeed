"use client";
/**
 * LhMark — the app mark: a comet (a dot with a fading tail), the same art as
 * build/icon-flat.svg without the tile. Inlined as JSX so it ships with the
 * components (no network fetch, crisp at any size). It draws in
 * currentColor, so it follows the theme's text color. Square viewBox, no
 * padding: sizing is the consumer's job.
 *
 * Replaces the "LH" wordmark text in the sidebar band (also the traffic-light
 * gutter's resident in the merged desktop chrome).
 */
import { useId } from "react";

export function LhMark({ className = "" }: { className?: string }) {
	const tail = useId();
	return (
		<svg viewBox="195 210 620 620" className={className} aria-hidden="true">
			<defs>
				<linearGradient id={tail} gradientUnits="userSpaceOnUse" x1="206" y1="818" x2="668" y2="364">
					<stop offset="0" stopColor="currentColor" stopOpacity="0" />
					<stop offset="0.55" stopColor="currentColor" stopOpacity="0.32" />
					<stop offset="1" stopColor="currentColor" stopOpacity="0.85" />
				</linearGradient>
			</defs>
			<path d="M763.3,461.0 L572.7,267.0 Q414.9,525.8 206,818 Q501.9,614.2 763.3,461.0 Z" fill={`url(#${tail})`} />
			<circle cx="668" cy="364" r="136" fill="currentColor" />
		</svg>
	);
}
