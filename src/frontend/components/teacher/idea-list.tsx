import { useEffect, useRef } from "react";
import { usePresence } from "@/frontend/components/presence";
import { ACTIVITY_ROW, ACTIVITY_ROWS } from "./activity-look";
import { cn } from "@/frontend/lib/utils";
import type { IdeaGroup } from "./starter-model";

const ROW = cn(ACTIVITY_ROW, "flex w-full flex-col py-2 text-left text-ui");

/**
 * Everything the teacher can be asked, over the foot of the panel's chat, just above its writing
 * row: a row per line, in groups. A press sends the line. A line that cannot work yet is dim and
 * says what it needs, and is no key.
 */
export function IdeaList({ groups, label, onSend }: { groups: readonly IdeaGroup[] | null; label: string; onSend: (line: string) => void }) {
	const shown = usePresence(groups !== null);
	// While it fades out it keeps its last lines.
	const last = useRef(groups);
	if (groups) last.current = groups;
	const card = useRef<HTMLDivElement>(null);
	const open = groups !== null;
	// Opened, the keyboard goes into it, so Esc closes it and is not typed in the box.
	useEffect(() => {
		if (open) card.current?.focus({ preventScroll: true });
	}, [open]);
	if (!shown.mounted || !last.current) return null;
	return (
		<div
			ref={card}
			role="dialog"
			aria-label={label}
			tabIndex={-1}
			data-lh-menu=""
			data-testid="talk-ideas-list"
			data-state={shown.state}
			className="lh-fade absolute inset-x-0 bottom-full z-10 grid max-h-[min(420px,60dvh)] grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-x-4 gap-y-4 overflow-y-auto rounded-t-(--lh-round) bg-bar px-[18px] pt-4 pb-3 outline-none"
		>
			<IdeaGroups groups={last.current} onSend={open ? onSend : null} />
		</div>
	);
}

/** The groups of ideas, each line a key that sends it (none while the list closes), or dim with
 *  what it needs. The Ideas list draws them, and so does a new chat's "All ideas". */
export function IdeaGroups({ groups, onSend }: { groups: readonly IdeaGroup[]; onSend: ((line: string) => void) | null }) {
	return groups.map((group) => (
		<section key={group.name} className="flex min-w-0 flex-col gap-2">
			<h3 className="px-3 text-ui font-medium text-ink">{group.name}</h3>
			<div className={ACTIVITY_ROWS}>
				{group.ideas.map((idea) =>
					idea.needs ? (
						<div key={idea.line} data-testid="talk-idea-off" className={cn(ROW, "text-ink-2")}>
							<span>{idea.line}</span>
							<span>{idea.needs}</span>
						</div>
					) : (
						<button key={idea.line} type="button" data-testid="talk-idea" disabled={!onSend} onClick={() => onSend?.(idea.line)} className={cn(ROW, "lh-press text-ink hover:bg-(--lh-key-hover)")}>
							{idea.line}
						</button>
					),
				)}
			</div>
		</section>
	));
}
