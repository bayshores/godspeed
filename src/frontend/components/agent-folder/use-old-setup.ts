import { useCallback, useState } from "react";
import { useAgentFolderView } from "./agent-folder-context";

/**
 * The old plugin or Codex block still left (the folder view's oldSetup),
 * and Remove. `removed` is what Remove took away, for the restart note.
 */
export function useOldSetup() {
	const { view, post, removed, setRemoved } = useAgentFolderView();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const remove = useCallback(async () => {
		if (!view) return;
		setBusy(true);
		setError(null);
		const failed = await post({ action: "remove-old-setup" });
		if (failed === null) setRemoved(view.oldSetup);
		setError(failed);
		setBusy(false);
	}, [view, post, setRemoved]);

	return { view, removed, busy, error, remove };
}
