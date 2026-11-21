import { useEffect, useRef } from "react";
import { NotePage } from "@/frontend/components/vault/note-page";
import { useVault } from "@/frontend/components/vault/vault-context";
import type { TurnNotes } from "./turn-next-model";

/** How long each page waits for the one before it to land (ms). */
const LAND_STEP = 150;

/**
 * The last topic's notes in "Your turn": the pages land one at a time, each inking in once written,
 * and under them the line saying whether they are saved. `pages` false leaves the pages out (the
 * pinned sheet is too short for them) and keeps the line.
 */
export function EndNotes({ notes, pages }: { notes: TurnNotes; pages: boolean }) {
	const { status } = useVault();
	// A page already there is not landed again when it inks in.
	const landed = useRef(new Set<string>());
	useEffect(() => {
		for (const page of notes.pages) landed.current.add(page.topicId);
	});
	if (notes.pages.length === 0) return null;
	return (
		<div data-testid="end-notes" className="flex flex-col gap-3">
			{pages && (
				<div className="lh-note-row">
					{notes.pages.map((page, i) => (
						<NotePage key={`${page.topicId}:${page.saving}`} note={page} obsidian={status?.obsidian ?? false} landing={landed.current.has(page.topicId) ? 0 : i * LAND_STEP} />
					))}
				</div>
			)}
			{notes.saved && (
				<p role="status" data-testid="notes-saved" className="text-base text-ink-2">
					{notes.saved}
				</p>
			)}
		</div>
	);
}
