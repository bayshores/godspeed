import { cn } from "@/frontend/lib/utils";

/**
 * The block at a row's left: a big count over its unit ("6" over "days"),
 * on the class's color. `pale` washes the color out, for a row that can
 * wait.
 */
export function CountBlock({ color, pale, count, unit }: { color: string; pale?: boolean; count: string; unit: string }) {
	return (
		<span
			className={cn("flex w-[116px] shrink-0 flex-col items-center justify-center self-stretch font-count", pale ? "text-ink" : "text-on-class")}
			style={{ background: pale ? `color-mix(in srgb, ${color} 57%, var(--lh-class-wash))` : color }}
		>
			{/* A word ("late") is set smaller than a number so it fits. */}
			<span className={count.length > 3 ? "py-3 text-[30px] leading-none" : "text-[54px] leading-[1.2]"}>{count}</span>
			{unit && <span className="text-base leading-none">{unit}</span>}
		</span>
	);
}
