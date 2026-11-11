import { cn } from "@/frontend/lib/utils";

/** The block's size and type: a Today row's, the smaller one of a class's
 *  Deadlines list, the square on the Progress tab's next deadline, or the
 *  one at the head of a deadline's page. */
const SIZES = {
	head: { box: "size-[120px]", count: "text-[60px] leading-[1.15]", word: "py-3 text-[30px] leading-none", unit: "text-[15px]" },
	square: { box: "size-[130px] self-start", count: "text-[65px] leading-[1.15]", word: "py-3 text-[34px] leading-none", unit: "text-[15px]" },
	row: { box: "w-[116px]", count: "text-[54px] leading-[1.2]", word: "py-3 text-[30px] leading-none", unit: "text-base" },
	list: { box: "w-24", count: "text-[34px] leading-[1.2]", word: "py-2 text-xl leading-none", unit: "text-base" },
};

/**
 * The block at a row's left: a big count over its unit ("6" over "days"),
 * on the class's color. `pale` washes the color out, for a row that can
 * wait.
 */
export function CountBlock({ color, pale, count, unit, size = "row" }: { color: string; pale?: boolean; count: string; unit: string; size?: keyof typeof SIZES }) {
	const s = SIZES[size];
	return (
		<span
			className={cn("flex shrink-0 flex-col items-center justify-center self-stretch font-count", s.box, pale ? "text-ink" : "text-on-class")}
			style={{ background: pale ? `color-mix(in srgb, ${color} 57%, var(--lh-class-wash))` : color }}
		>
			{/* A word ("late") is set smaller than a number so it fits. */}
			<span className={count.length > 3 ? s.word : s.count}>{count}</span>
			{unit && <span className={cn("leading-none", s.unit)}>{unit}</span>}
		</span>
	);
}
