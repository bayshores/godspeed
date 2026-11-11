/**
 * The block at a row's left: a big count over its unit ("6" over "days"),
 * on the class's color. `pale` washes the color out, for a row that can
 * wait.
 */
export function CountBlock({ color, pale, count, unit }: { color: string; pale?: boolean; count: string; unit: string }) {
	return (
		<span
			className="flex w-[112px] shrink-0 flex-col items-center justify-center gap-1.5 self-stretch font-count text-on-class"
			style={{ background: pale ? `color-mix(in oklab, ${color} 45%, var(--lh-class-wash))` : color }}
		>
			{/* A word ("late") is set smaller than a number so it fits. */}
			<span className={count.length > 3 ? "text-[30px] leading-none" : "text-[60px] leading-none"}>{count}</span>
			{unit && <span className="text-[15px] leading-none">{unit}</span>}
		</span>
	);
}
