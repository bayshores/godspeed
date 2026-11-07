import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, FileMinusIcon, FilePlusIcon } from "lucide-react";
import { RECENT_CHANGE_DAYS } from "@/shared/core";
import { shortDate } from "./files-model";
import { changeDay, type RecentChange } from "./recent-changes-model";

export const RECENT_CHANGES_KEY = "recent-changes";
/** Changes shown before "Show N more" (a class set up by hand brings dozens at once). */
const FIRST_SHOWN = 8;

/**
 * RECENT CHANGES (Files page): the files added to or removed from the
 * class lately, newest first, folded like a file group. A removed file is
 * crossed out. Past the first few, "Show N more" opens the rest.
 */
export function RecentChanges({ changes, collapsed, onToggle }: { changes: readonly RecentChange[]; collapsed: boolean; onToggle: (key: string) => void }) {
	const Chevron = collapsed ? ChevronRightIcon : ChevronDownIcon;
	const [all, setAll] = useState(false);
	const shown = all ? changes : changes.slice(0, FIRST_SHOWN);
	const more = changes.length - shown.length;
	return (
		<section data-testid="files-recent-changes" aria-label="Recent changes" className="flex w-full flex-col bg-panel px-1.5 pt-1.5 pb-1.5">
			<button
				type="button"
				aria-expanded={!collapsed}
				data-testid="files-recent-changes-toggle"
				onClick={() => onToggle(RECENT_CHANGES_KEY)}
				className="lh-press flex items-center gap-2 px-2.5 py-2.5 text-left hover:bg-tone"
			>
				<Chevron className="size-3.5 shrink-0 text-ink-3" aria-hidden />
				<h2 className="text-[15px] font-bold text-ink">Recent changes</h2>
				<span className="text-[13px] text-ink-3">last {RECENT_CHANGE_DAYS} days</span>
			</button>
			{!collapsed && (
				<ul className="flex flex-col">
					{shown.map((c) => {
						const removed = c.change === "removed";
						const Icon = removed ? FileMinusIcon : FilePlusIcon;
						return (
							<li key={`${c.change}:${c.id}`} data-testid={`files-change-${c.change}-${c.id}`} className="flex items-center gap-2.5 border-t border-tone py-2 pr-3 pl-2 first:border-t-0">
								<Icon className="size-[15px] shrink-0 text-ink-2" aria-hidden />
								<span className="flex min-w-0 flex-1 items-center gap-1.5">
									<span title={c.name} className={removed ? "min-w-0 truncate text-[14.5px] text-ink-3 line-through" : "min-w-0 truncate text-[14.5px] text-ink"}>
										{c.name}
									</span>
									<span className={removed ? "shrink-0 border border-tone-2 px-1.5 text-[11.5px] font-bold text-ink-2" : "shrink-0 bg-tone px-1.5 text-[11.5px] font-bold text-ink"}>
										{removed ? "Removed" : "Added"}
									</span>
								</span>
								<span className="shrink-0 text-[12.5px] text-ink-3">{shortDate(changeDay(c.at))}</span>
							</li>
						);
					})}
				</ul>
			)}
			{!collapsed && more > 0 && (
				<button
					type="button"
					data-testid="files-recent-changes-more"
					onClick={() => setAll(true)}
					className="lh-press self-start px-2.5 py-2 text-[13.5px] font-bold text-ink-2 hover:bg-tone hover:text-ink"
				>
					Show {more} more
				</button>
			)}
		</section>
	);
}
