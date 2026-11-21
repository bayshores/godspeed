import { useLayoutEffect, useRef, useState } from "react";
import { Pane } from "@/frontend/components/ui/pane";
import { NotePage } from "@/frontend/components/vault/note-page";
import { useSpaceNotes } from "@/frontend/components/vault/use-space-notes";

/** A page's width and the gap between pages, as in `.lh-note-row` and `.lh-note-page`. */
const PAGE = 168;
const GAP = 12;

/**
 * THE NOTES CARD (Progress): a space's note pages in one row, the weakest topic first. "All"
 * shows every page, wrapped in the same card. Left out with no notes folder or no note.
 */
export function NotesCard({ spaceId }: { spaceId: string | null }) {
	const { notes, obsidian } = useSpaceNotes(spaceId);
	const [all, setAll] = useState(false);
	// How many pages one row holds; until the row is measured, all of them.
	const [fit, setFit] = useState(Number.POSITIVE_INFINITY);
	const rowRef = useRef<HTMLDivElement>(null);
	const empty = notes.length === 0;
	useLayoutEffect(() => {
		const row = rowRef.current;
		if (!row) return;
		const measure = () => setFit(Math.max(1, Math.floor((row.clientWidth + GAP) / (PAGE + GAP))));
		measure();
		const watch = new ResizeObserver(measure);
		watch.observe(row);
		return () => watch.disconnect();
	}, [empty]);
	if (empty) return null;
	const more = notes.length > fit;
	return (
		<Pane data-testid="notes-card" data-all={all || undefined} className="lh-card">
			<div className="lh-card-head">
				<h2 className="lh-card-title">
					{obsidian ? "Obsidian" : "Notes"}
					<span className="font-count text-base whitespace-nowrap text-ink-2">{` ${notes.length}`}</span>
				</h2>
				{!all && more && (
					<button type="button" data-testid="notes-all" onClick={() => setAll(true)} className="lh-btn shrink-0">
						All
					</button>
				)}
			</div>
			<div ref={rowRef} data-testid="notes-row" className="lh-note-row">
				{(all ? notes : notes.slice(0, fit)).map((note) => (
					<NotePage key={note.topicId} note={note} obsidian={obsidian} />
				))}
			</div>
		</Pane>
	);
}
