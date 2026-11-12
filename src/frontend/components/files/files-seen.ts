import { useEffect, useState } from "react";
import { isRecent } from "@/shared/core";

/**
 * The Files tab's "new" mark: a folder scan found files in the active space
 * since the learner last opened its Files page (and they are still new).
 * What was seen is remembered per space in this browser only.
 */

const seenKey = (spaceId: string) => `lh:files-seen:${spaceId}`;

/** `lastFoundAt` is the space's newest found file; `seenAt` the newest one
 *  the learner has seen. */
export function hasUnseenFiles(lastFoundAt: string | undefined, seenAt: string | null, now: number): boolean {
	return !!lastFoundAt && isRecent(lastFoundAt, now) && (!seenAt || lastFoundAt > seenAt);
}

export function useUnseenFiles(spaceId: string | null, lastFoundAt: string | undefined, onFilesPage: boolean): boolean {
	const [unseen, setUnseen] = useState(false);
	useEffect(() => {
		if (!spaceId) return setUnseen(false);
		if (onFilesPage) {
			if (lastFoundAt) {
				try {
					window.localStorage.setItem(seenKey(spaceId), lastFoundAt);
				} catch {
					// Only a convenience: the mark shows again next time.
				}
			}
			return setUnseen(false);
		}
		let seenAt: string | null = null;
		try {
			seenAt = window.localStorage.getItem(seenKey(spaceId));
		} catch {
			// Unreadable storage counts as nothing seen.
		}
		setUnseen(hasUnseenFiles(lastFoundAt, seenAt, Date.now()));
	}, [spaceId, lastFoundAt, onFilesPage]);
	return unseen;
}
