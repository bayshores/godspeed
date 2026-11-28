/** A topic panel's key for the topic's note, when it has one: the crystal and "Open in Obsidian" (or the notes folder's words). */
import { useSpaces } from "@/frontend/components/space-context";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { browserName, canOpenNote, openNote } from "@/frontend/components/vault/open-note";
import { useSpaceNotes } from "@/frontend/components/vault/use-space-notes";
import { openLabel } from "@/frontend/components/vault/vault-model";

export function NoteKey({ topicId }: { topicId: string }) {
	const { active } = useSpaces();
	const { notes, obsidian } = useSpaceNotes(active);
	const path = notes.find((n) => n.topicId === topicId)?.path;
	if (!path || !canOpenNote(obsidian)) return null;
	return (
		<button type="button" data-testid="topic-note-open" onClick={() => openNote(path, obsidian)} className="lh-btn lh-btn-small lh-btn-quiet shrink-0">
			<PixelIcon name="crystal" size={12} />
			{openLabel(obsidian, browserName())}
		</button>
	);
}
