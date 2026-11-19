import { useState, type CSSProperties } from "react";
import type { SpaceColor, SpaceSummary } from "@/shared/core";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { blockColor, paleSpaceColor } from "@/frontend/components/space-color";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { useFold } from "@/frontend/components/use-fold";
import { cn } from "@/frontend/lib/utils";
import { cutColumn, type WeekColumn, type WeekItem } from "./week-columns-model";

/**
 * The week as seven day columns from today, each a well headed by its day
 * and date with what is due that day as blocks in their spaces' colors,
 * then Later for what is due after it. Every column is as tall as the
 * fullest, so the week reads as one even band. A click on a block shows it
 * in the card above. A column with more than four shows three and a key
 * that unfolds the whole week.
 */
export function WeekColumns({
	columns,
	spaces,
	picked,
	onPick,
}: {
	columns: readonly WeekColumn[];
	spaces: readonly SpaceSummary[];
	/** The deadline the card shows. */
	picked: string | null;
	onPick: (d: OpenDeadline) => void;
}) {
	const [open, setOpen] = useState(false);
	const fold = useFold(open);
	// WebKit keeps an open fold's height when a resize rewraps the names in it, which
	// cuts off the last block, so once it has eased open the fold is a plain box.
	const [eased, setEased] = useState(false);
	const settled = fold.state === "open" && (eased || prefersReducedMotion());
	const color = (d: OpenDeadline) => spaces.find((s) => s.id === d.spaceId)?.color;
	return (
		<div data-testid="week-columns" className="@container">
			{/* A narrow week gives an empty day less room, so the names in the others keep whole words, but never less than its head.
			    Under 600px eight columns have no room: the days with something due, and today, are rows. */}
			<div
				style={{ "--week-cols": columns.map((c) => (c.items.length > 0 ? "minmax(0, 1fr)" : "minmax(min-content, var(--day-empty))")).join(" ") } as CSSProperties}
				className="grid grid-cols-(--week-cols) gap-[6px] [--day-empty:1fr] @max-[760px]:[--day-empty:0.6fr] @max-[600px]:grid-cols-1"
			>
				{columns.map((column) => {
					const { first, rest } = cutColumn(column.items);
					const block = (item: WeekItem) => (
						<WeekBlock key={item.deadline.id} item={item} dated={column.day === null} color={color(item.deadline)} picked={item.deadline.id === picked} onPick={onPick} />
					);
					return (
						<section key={column.day ?? "later"} data-testid={column.day ? `week-day-${column.day}` : "week-later"} className={cn("flex min-w-0 flex-col gap-1 bg-tone p-1 @max-[600px]:flex-row", column.items.length === 0 && !column.today && "@max-[600px]:hidden")}>
							<h3 className={cn("px-1.5 py-0.5 text-[15px] leading-snug whitespace-nowrap @max-[600px]:w-[76px] @max-[600px]:shrink-0 @max-[600px]:self-start", column.today ? "bg-highlight text-ink" : "text-ink-2")}>
								<span aria-hidden>
									{column.short}
									{column.date !== null && <span className="font-count"> {column.date}</span>}
								</span>
								<span className="sr-only">{column.long}</span>
							</h3>
							<div className="flex min-w-0 flex-1 flex-col gap-1">
								{first.map(block)}
								{rest.length > 0 && fold.mounted && (
									<div
										data-testid="week-rest"
										data-state={fold.state}
										onTransitionEnd={(e) => e.target === e.currentTarget && open && setEased(true)}
										className={cn("-mt-1", !settled && "lh-collapse")}
									>
										<div>
											<div className="flex flex-col gap-1 pt-1">{rest.map(block)}</div>
										</div>
									</div>
								)}
								{rest.length > 0 && (
									<button type="button" data-testid="week-more" aria-expanded={open} onClick={() => {
											setOpen(!open);
											setEased(false);
										}} className="lh-btn lh-btn-quiet lh-btn-small self-start">
										{open ? "Show less" : `+${rest.length} more`}
									</button>
								)}
							</div>
						</section>
					);
				})}
			</div>
		</div>
	);
}

/** One thing due: its name on its space's color, "late" first when it is past due,
 *  struck through once done. `dated`: in Later, its date always shows under the name. */
function WeekBlock({ item, dated, color, picked, onPick }: { item: WeekItem; dated: boolean; color: SpaceColor | undefined; picked: boolean; onPick: (d: OpenDeadline) => void }) {
	const d = item.deadline;
	return (
		// The teacher points at the wrapper; a light lands on its first child, the block.
		<div data-teacher-target={`deadline:${d.id}`}>
			<button
				type="button"
				data-testid={`week-item-${d.id}`}
				aria-pressed={picked}
				aria-label={item.label}
				title={d.name}
				onClick={() => onPick(d)}
				style={{ background: item.done && color ? paleSpaceColor(color) : blockColor(color) }}
				className={cn("lh-press flex min-h-10 w-full flex-col items-start border-2 px-1.5 py-1 text-left text-on-space", picked ? "border-ink" : "border-transparent")}
			>
				{item.late && <span className="mb-0.5 bg-ans-wrong px-1 text-[12px] leading-[1.4] text-background">late</span>}
				{/* Under 1000px of week a day's name is small and alone; from it, and in a row, its time shows under it. */}
				<span className={cn("line-clamp-3 w-full text-[13px] leading-[1.3] hyphens-manual wrap-anywhere @min-[1000px]:text-[15px]", item.done && "line-through")}>{d.name}</span>
				{item.detail && <span className={cn("w-full truncate text-[13px] leading-[1.3]", dated ? "block" : "hidden @min-[1000px]:block @max-[600px]:block")}>{item.detail}</span>}
			</button>
		</div>
	);
}
