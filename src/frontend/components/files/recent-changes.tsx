import { useState } from "react";
import { RECENT_CHANGE_DAYS } from "@/shared/core";
import { cn } from "@/frontend/lib/utils";
import { shortDate } from "./files-model";
import { SectionToggle } from "./files-sections";
import { changeDay, type RecentChange } from "./recent-changes-model";

export const RECENT_CHANGES_KEY = "recent-changes";
/** Changes shown before "Show N more" (a space set up by hand brings dozens at once). */
const FIRST_SHOWN = 8;

/**
 * RECENT CHANGES (Files page, first in the file list): the files added to
 * or removed from the space lately, newest first, folded like a file
 * group. A removed file is greyed with "Removed" in red. Past the first
 * few, "Show N more" opens the rest.
 */
export function RecentChanges({ changes, collapsed, onToggle }: { changes: readonly RecentChange[]; collapsed: boolean; onToggle: (key: string) => void }) {
	const [all, setAll] = useState(false);
	const shown = all ? changes : changes.slice(0, FIRST_SHOWN);
	const more = changes.length - shown.length;
	return (
		<section data-testid="files-recent-changes" aria-label="Recent changes" className="flex w-full flex-col">
			<SectionToggle
				label="Recent changes"
				note={`last ${RECENT_CHANGE_DAYS} days`}
				collapsed={collapsed}
				testid="files-recent-changes-toggle"
				onClick={() => onToggle(RECENT_CHANGES_KEY)}
			/>
			{!collapsed && (
				<ul className="flex flex-col">
					{shown.map((c) => {
						const removed = c.change === "removed";
						return (
							<li key={`${c.change}:${c.id}`} data-testid={`files-change-${c.change}-${c.id}`} className="flex items-center gap-3 py-1.5 pr-1 pl-[30px]">
								<span title={c.name} className={cn("min-w-0 flex-1 truncate text-[15px]", removed ? "text-ink-3" : "text-ink")}>
									{c.name}
								</span>
								<span className={cn("w-[70px] shrink-0 text-base", removed ? "text-ans-wrong" : "text-ink")}>{removed ? "Removed" : "Added"}</span>
								<span className="font-count w-24 shrink-0 text-base text-ink-2">{shortDate(changeDay(c.at))}</span>
							</li>
						);
					})}
				</ul>
			)}
			{!collapsed && more > 0 && (
				<div className="pt-0.5 pr-1 pb-2 pl-[30px]">
					<button type="button" data-testid="files-recent-changes-more" onClick={() => setAll(true)} className="lh-btn lh-btn-quiet -ml-1.5 text-[15px]">
						Show {more} more
					</button>
				</div>
			)}
		</section>
	);
}
