import { useState, type CSSProperties } from "react";
import type { SpaceColor, SpaceSummary } from "@/shared/core";
import { useArrivals } from "@/frontend/components/presence";
import { chip } from "@/frontend/components/ui/chip";
import { rowMotion } from "@/frontend/components/motion";
import { blockColor, paleSpaceColor, spaceLineColor } from "@/frontend/components/space-color";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { useFold } from "@/frontend/components/use-fold";
import { cn } from "@/frontend/lib/utils";
import { cutColumn, type WeekColumn, type WeekItem, type WeekPick } from "./week-columns-model";

/**
 * The week as seven day columns from today, each a well headed by its day
 * and date with what is due that day as blocks in their spaces' colors,
 * then Later for what is due after it. Every column is as tall as the
 * fullest, so the week reads as one even band. A deadline that looks
 * missing is its outline on the day it was expected. A click on a block or
 * an outline shows it in the card above. A column with more than four shows
 * three and a key that unfolds the whole week. One that joins the week
 * after it first drew steps in; an outline that leaves fades.
 */
export function WeekColumns({
	columns,
	spaces,
	picked,
	onPick,
}: {
	columns: readonly WeekColumn[];
	spaces: readonly SpaceSummary[];
	/** What the card shows. */
	picked: WeekPick | null;
	onPick: (pick: WeekPick) => void;
}) {
	const [open, setOpen] = useState(false);
	const fold = useFold(open);
	// WebKit keeps an open fold's height when a resize rewraps the names in it, which
	// cuts off the last block, so once it has eased open the fold is a plain box.
	const [eased, setEased] = useState(false);
	const settled = fold.state === "open" && (eased || prefersReducedMotion());
	const arrive = useArrivals();
	const color = (spaceId: string) => spaces.find((s) => s.id === spaceId)?.color;
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
						<WeekBlock key={item.key} item={item} dated={column.day === null} color={color(item.spaceId)} picked={picked?.kind === item.kind && picked.key === item.key} joined={!!arrive(item.key)} onPick={onPick} />
					);
					return (
						<section key={column.day ?? "later"} data-testid={column.day ? `week-day-${column.day}` : "week-later"} className={cn("flex min-w-0 flex-col gap-1 bg-tone p-1 @max-[600px]:flex-row", column.items.length === 0 && !column.today && "@max-[600px]:hidden")}>
							<h3 className={cn("px-1.5 py-0.5 text-ui leading-snug whitespace-nowrap @max-[600px]:w-[76px] @max-[600px]:shrink-0 @max-[600px]:self-start", column.today ? "bg-highlight text-ink" : "text-ink-2")}>
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
 *  struck through once done. An outline has no fill: dashes in its space's color (in ink
 *  while picked) around its name. `dated`: in Later, its date always shows under the name. */
function WeekBlock({ item, dated, color, picked, joined, onPick }: { item: WeekItem; dated: boolean; color: SpaceColor | undefined; picked: boolean; joined: boolean; onPick: (pick: WeekPick) => void }) {
	const leaving = item.kind === "gap" && item.leaving;
	const face =
		item.kind === "gap"
			? { "--lh-dash": picked ? "var(--color-ink)" : color && spaceLineColor(color) }
			: { background: item.done && color ? paleSpaceColor(color) : blockColor(color) };
	return (
		<div {...rowMotion(leaving, joined)}>
			<button
				type="button"
				data-testid={item.kind === "gap" ? "week-gap" : `week-item-${item.key}`}
				data-gap={item.kind === "gap" ? item.key : undefined}
				data-teacher-target={item.kind === "deadline" ? `deadline:${item.key}` : undefined}
				aria-pressed={picked}
				aria-label={item.label}
				title={item.name}
				onClick={() => onPick({ kind: item.kind, key: item.key })}
				style={face as CSSProperties}
				className={cn(
					"lh-press relative flex min-h-10 w-full flex-col items-start border-2 px-1.5 py-1 text-left",
					item.kind === "gap" ? "border-transparent text-ink" : ["text-on-space", picked ? "border-ink" : "border-transparent"],
				)}
			>
				{/* On a box of its own: the focus rule takes a focused button's own outline away. */}
				{item.kind === "gap" && <span aria-hidden className="lh-dashed pointer-events-none absolute -inset-0.5" />}
				{item.late && <span className={cn(chip("wrong", "tag"), "mb-0.5")}>late</span>}
				{/* Under 1000px of week a day's name is small and alone; from it, and in a row, its time shows under it. */}
				<span className={cn("line-clamp-3 w-full text-sm leading-ask hyphens-manual wrap-anywhere @min-[1000px]:text-ui", item.done && "line-through")}>{item.name}</span>
				{item.detail && <span className={cn("w-full truncate text-sm leading-ask", dated ? "block" : "hidden @min-[1000px]:block @max-[600px]:block")}>{item.detail}</span>}
			</button>
		</div>
	);
}
