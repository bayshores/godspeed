import { useEffect, useState } from "react";
import { isRecent } from "@/shared/core";

/**
 * The Files tab's "new" mark and Today's new-files line: a folder scan found
 * files in a space since the learner last opened its Files page (and they
 * are still new).
 * What was seen is remembered per space in this browser only.
 */

const seenKey = (spaceId: string) => `lh:files-seen:${spaceId}`;

/** The newest found file the learner saw on the space's Files page; null
 *  when none, or when storage can't be read. */
export function filesSeenAt(spaceId: string): string | null {
	try {
		return window.localStorage.getItem(seenKey(spaceId));
	} catch {
		return null;
	}
}

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
		setUnseen(hasUnseenFiles(lastFoundAt, filesSeenAt(spaceId), Date.now()));
	}, [spaceId, lastFoundAt, onFilesPage]);
	return unseen;
}
