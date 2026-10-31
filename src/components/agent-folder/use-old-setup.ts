"use client";

import { useCallback, useEffect, useState } from "react";
import type { OldSetup } from "@/core";
import type { FolderView } from "./agent-folder-model";
import { postAgentFolder } from "./use-agent-folder";

/** Tells the corner notice and Settings that one of them removed it. */
const CHANGED_EVENT = "lh:old-setup-changed";

/**
 * The old plugin or Codex block still left (the folder view's oldSetup),
 * and Remove. `removed` is what Remove took away, for the restart note.
 */
export function useOldSetup() {
	const [view, setView] = useState<FolderView | null>(null);
	const [removed, setRemoved] = useState<OldSetup | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		fetch("/api/agent-folder", { cache: "no-store" })
			.then((r) => (r.ok ? (r.json() as Promise<FolderView>) : null))
			.then((v) => v && setView(v))
			.catch(() => {/* checked again next start */});
		const changed = (e: Event) => {
			const { view: next, removed: gone } = (e as CustomEvent<{ view: FolderView; removed: OldSetup }>).detail;
			setView(next);
			setRemoved(gone);
		};
		window.addEventListener(CHANGED_EVENT, changed);
		return () => window.removeEventListener(CHANGED_EVENT, changed);
	}, []);

	const remove = useCallback(async () => {
		if (!view) return;
		setBusy(true);
		setError(null);
		try {
			const next = await postAgentFolder({ action: "remove-old-setup" });
			window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: { view: next, removed: view.oldSetup } }));
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	}, [view]);

	return { view, removed, busy, error, remove };
}
