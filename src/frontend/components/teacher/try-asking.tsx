import { useState } from "react";
import { useFold } from "@/frontend/components/use-fold";
import { cn } from "@/frontend/lib/utils";
import { IdeaGroups } from "./idea-list";
import type { IdeaGroup } from "./starter-model";

/** "Try asking" in a new chat: the page's lines as rows, each sent as if typed, then "All ideas",
 *  which unfolds every group in place. `off` while nothing can answer them (the agent can't run):
 *  dim, and no key takes a click. */
export function TryAsking({ starters, groups, off, onSend }: { starters: readonly string[]; groups: readonly IdeaGroup[]; off: boolean; onSend: (line: string) => void }) {
	const [all, setAll] = useState(false);
	const fold = useFold(all);
	if (starters.length === 0) return null;
	return (
		<div data-testid="talk-try" inert={off} className={cn("flex flex-col gap-3 transition-opacity duration-(--lh-dur) ease-(--lh-ease-out)", off && "opacity-45")}>
			<h3 className="text-[18px] leading-7 text-ink">Try asking</h3>
			<div className="flex flex-col gap-1.5">
				{starters.map((line) => (
					<button key={line} type="button" data-testid="talk-starter" onClick={() => onSend(line)} className="lh-sheet lh-press w-full truncate px-4 py-2.5 text-left text-[16px] text-ink hover:bg-(--lh-key-hover)">
						{line}
					</button>
				))}
			</div>
			{!all && (
				<button type="button" data-testid="talk-all-ideas" onClick={() => setAll(true)} className="lh-btn self-start">
					All ideas
				</button>
			)}
			{fold.mounted && (
				<div className="lh-collapse" data-state={fold.state}>
					<div>
						<div className="flex flex-col gap-4 pt-2">
							<IdeaGroups groups={groups} onSend={onSend} />
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
