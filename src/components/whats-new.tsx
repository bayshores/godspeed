"use client";

/**
 * "WHAT'S NEW" (owner, 2026-10-27): after an update, the first launch
 * opens this dialog with the changelog entries the learner skipped over
 * (src/changelog.json, newest first). The root layout passes `since` from
 * src/server/whats-new.ts; Settings → General → Release notes reopens it
 * with the current version's notes (openWhatsNew). Styled as the app's
 * other dialogs (class-dialog.tsx): square panel, tone outline, one white
 * button.
 */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePresence } from "@/components/presence";
import { WhatsNewDialog } from "@/components/whats-new-dialog";
import { entriesSince, entryFor, type ChangelogEntry } from "@/core";

const VERSION = process.env.LH_VERSION ?? "";
const OPEN_EVENT = "lh:whats-new";

/** Settings' Release notes link: true when this version has notes to show. */
export function hasWhatsNew(version: string = VERSION): boolean {
	return entryFor(version) !== null;
}

/** Opens the notes since `since` (the welcome screen hands over the
 *  launch's missed notes), or this version's notes without it. */
export function openWhatsNew(since?: string): void {
	window.dispatchEvent(new CustomEvent<string | undefined>(OPEN_EVENT, { detail: since }));
}

export function WhatsNew({ since }: { since: string | null }) {
	// Opens after hydration: the server renders nothing (the dialog portals
	// into document.body), so the first client render must match that.
	const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
	useEffect(() => {
		if (!since) return;
		const missed = entriesSince(since, VERSION);
		if (missed.length > 0) setEntries(missed);
	}, [since]);
	useEffect(() => {
		const open = (e: Event) => {
			const since = (e as CustomEvent<string | undefined>).detail;
			if (since) {
				const missed = entriesSince(since, VERSION);
				if (missed.length > 0) setEntries(missed);
				return;
			}
			const current = entryFor(VERSION);
			if (current) setEntries([current]);
		};
		window.addEventListener(OPEN_EVENT, open);
		return () => window.removeEventListener(OPEN_EVENT, open);
	}, []);
	const close = useCallback(() => setEntries(null), []);

	const presence = usePresence(entries !== null);
	const [shown, setShown] = useState(entries);
	if (entries !== null && entries !== shown) setShown(entries);
	if (!presence.mounted || !shown) return null;
	return createPortal(<WhatsNewDialog entries={shown} state={presence.state} onClose={close} />, document.body);
}
