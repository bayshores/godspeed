import { cn } from "@/frontend/lib/utils";

/** The block's size and type: the smaller one of a space's Deadlines list,
 *  the one a size up flush with Home's card, the band on the Progress
 *  tab's next deadline, or the one at the head of a deadline's page. */
const SIZES = {
	head: { box: "min-h-[120px] w-[120px]", count: "text-[60px] leading-[1.15]", unit: "text-[15px]" },
	band: { box: "w-[116px]", count: "text-[54px] leading-[1.2]", unit: "text-base" },
	card: { box: "w-[112px]", count: "text-[42px] leading-[1.2]", unit: "text-base" },
	list: { box: "w-24", count: "text-[34px] leading-[1.2]", unit: "text-base" },
};

/**
 * The block at a row's left: a big count over its unit ("6" over "days"),
 * on the space's color. `pale` washes the color out, for a row that can
 * wait.
 */
export function CountBlock({
	color,
	pale,
	count,
	unit,
	size,
	className,
}: {
	color: string;
	pale?: boolean;
	count: string;
	unit: string;
	size: keyof typeof SIZES;
	/** Changes to its box, such as a narrow card's strip. */
	className?: string;
}) {
	const s = SIZES[size];
	return (
		<span
			className={cn("flex shrink-0 flex-col items-center justify-center self-stretch font-count", s.box, pale ? "text-ink" : "text-on-space", className)}
			style={{ background: pale ? `color-mix(in srgb, ${color} 57%, var(--lh-space-wash))` : color }}
		>
			{/* The digits sit low in their line, so the number is pulled up to leave the same room above it as below its unit. */}
			<span className={cn(s.count, "-mt-[0.16em]")}>{count}</span>
			{/* The dot font's space is a full cell wide, too wide between "days" and "late". */}
			<span className={cn("leading-none [word-spacing:-0.3em]", s.unit)}>{unit}</span>
		</span>
	);
}
