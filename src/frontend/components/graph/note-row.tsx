/** The last row of a topic's panel when the topic has a note: the crystal and "Open in Obsidian". */
import { useSpaces } from "@/frontend/components/space-context";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { browserName, canOpenNote, openNote } from "@/frontend/components/vault/open-note";
import { useSpaceNotes } from "@/frontend/components/vault/use-space-notes";
import { openLabel } from "@/frontend/components/vault/vault-model";
import { PANE_ROW } from "./styles.ts";

export function NoteRow({ topicId }: { topicId: string }) {
	const { active } = useSpaces();
	const { notes, obsidian } = useSpaceNotes(active);
	const path = notes.find((n) => n.topicId === topicId)?.path;
	if (!path || !canOpenNote(obsidian)) return null;
	return (
		<button type="button" data-testid="topic-note-open" onClick={() => openNote(path, obsidian)} className={PANE_ROW}>
			<PixelIcon name="crystal" className="h-4 shrink-0 text-ink" />
			<span className="min-w-0 underline underline-offset-2">{openLabel(obsidian, browserName())}</span>
		</button>
	);
}
