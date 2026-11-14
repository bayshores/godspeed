import { cn } from "@/frontend/lib/utils";

/** The block's size and type: Today's card, a Today row's, the smaller one
 *  of a space's Deadlines list, the square on the Progress tab's next
 *  deadline, or the one at the head of a deadline's page. */
const SIZES = {
	card: { box: "w-[150px]", count: "text-[92px] leading-[1.15]", word: "py-4 text-[40px] leading-none", unit: "text-lg" },
	head: { box: "size-[120px]", count: "text-[60px] leading-[1.15]", word: "py-3 text-[30px] leading-none", unit: "text-[15px]" },
	square: { box: "size-[130px] self-start", count: "text-[65px] leading-[1.15]", word: "py-3 text-[34px] leading-none", unit: "text-[15px]" },
	row: { box: "w-[116px]", count: "text-[54px] leading-[1.2]", word: "py-3 text-[30px] leading-none", unit: "text-base" },
	list: { box: "w-24", count: "text-[34px] leading-[1.2]", word: "py-2 text-xl leading-none", unit: "text-base" },
	today: { box: "size-14", count: "text-[28px] leading-[1.2]", word: "text-[15px] leading-none", unit: "text-xs" },
};

/**
 * The block at a row's left: a big count over its unit ("6" over "days"),
 * on the space's color. `pale` washes the color out, for a row that can
 * wait.
 */
export function CountBlock({ color, pale, count, unit, size = "row" }: { color: string; pale?: boolean; count: string; unit: string; size?: keyof typeof SIZES }) {
	const s = SIZES[size];
	return (
		<span
			className={cn("flex shrink-0 flex-col items-center justify-center self-stretch font-count", s.box, pale ? "text-ink" : "text-on-space")}
			style={{ background: pale ? `color-mix(in srgb, ${color} 57%, var(--lh-space-wash))` : color }}
		>
			{/* A word ("late") is set smaller than a number so it fits. The digits sit low in their
			    line, so a number is pulled up to leave the same room above it as below its unit. */}
			<span className={count.length > 3 ? s.word : cn(s.count, "-mt-[0.16em]")}>{count}</span>
			{unit && <span className={cn("leading-none", s.unit)}>{unit}</span>}
		</span>
	);
}
