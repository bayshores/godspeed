import { useEffect, useRef } from "react";
import { NotePage } from "@/frontend/components/vault/note-page";
import { useVault } from "@/frontend/components/vault/vault-context";
import type { TurnNotes } from "./turn-next-model";

/** How long each page waits for the one before it to land (ms). */
const LAND_STEP = 150;

/**
 * The last topic's notes in "Your turn": the pages land one at a time, each inking in once written.
 * The page asked about is lit. The pages keep one row that scrolls sideways: the sheet is short, on the
 * book's right page as under the text, and a second row would be cut. They narrow a little before they
 * scroll, so three fit the narrowest sheet whole.
 */
export function EndNotes({ notes }: { notes: TurnNotes }) {
	const { status } = useVault();
	// A page already there is not landed again when it inks in.
	const landed = useRef(new Set<string>());
	useEffect(() => {
		for (const page of notes.pages) landed.current.add(page.topicId);
	});
	if (notes.pages.length === 0) return null;
	return (
		<div data-testid="end-notes" className="lh-note-row flex-nowrap overflow-x-auto *:min-w-[152px] *:shrink">
			{notes.pages.map((page, i) => (
				<NotePage key={`${page.topicId}:${page.saving}`} note={page} obsidian={status?.obsidian ?? false} asked={notes.ask?.topicId === page.topicId} landing={landed.current.has(page.topicId) ? 0 : i * LAND_STEP} />
			))}
		</div>
	);
}

/** Whether the pages are saved, said under them. */
export function NotesSaved({ notes }: { notes: TurnNotes }) {
	if (notes.pages.length === 0 || !notes.saved) return null;
	return (
		<p role="status" data-testid="notes-saved" data-whole className="-mt-3 shrink-0 text-[15px] text-ink-2">
			{notes.saved}
		</p>
	);
}
