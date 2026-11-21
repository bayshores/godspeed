import { useServerResource } from "@/frontend/components/use-server-resource";
import type { VaultNote } from "./note-pages-model";
import { useVault } from "./vault-context";

/** A space's note pages, the weakest topic first; empty without a notes folder. */
export function useSpaceNotes(spaceId: string | null): { notes: VaultNote[]; obsidian: boolean } {
	const { status } = useVault();
	const url = spaceId && status?.folder ? `/api/spaces/${spaceId}/vault-notes` : null;
	const { value } = useServerResource<{ notes: VaultNote[] }>(url, { on: { "vault-notes-changed": true } });
	return { notes: value?.notes ?? [], obsidian: status?.obsidian ?? false };
}
