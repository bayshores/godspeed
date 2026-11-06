import { useEffect, useState } from "react";
import { isRecent } from "@/shared/core";

/**
 * The sidebar's Files dot: a folder scan found files in the active class
 * since the learner last opened its Files page (and they are still new).
 * What was seen is remembered per class in this browser only.
 */

const seenKey = (classId: string) => `lh:files-seen:${classId}`;

/** `lastFoundAt` is the class's newest found file; `seenAt` the newest one
 *  the learner has seen. */
export function hasUnseenFiles(lastFoundAt: string | undefined, seenAt: string | null, now: number): boolean {
	return !!lastFoundAt && isRecent(lastFoundAt, now) && (!seenAt || lastFoundAt > seenAt);
}

export function useUnseenFiles(classId: string | null, lastFoundAt: string | undefined, onFilesPage: boolean): boolean {
	const [unseen, setUnseen] = useState(false);
	useEffect(() => {
		if (!classId) return setUnseen(false);
		if (onFilesPage) {
			if (lastFoundAt) {
				try {
					window.localStorage.setItem(seenKey(classId), lastFoundAt);
				} catch {
					// Only a convenience: the dot shows again next time.
				}
			}
			return setUnseen(false);
		}
		let seenAt: string | null = null;
		try {
			seenAt = window.localStorage.getItem(seenKey(classId));
		} catch {
			// Unreadable storage counts as nothing seen.
		}
		setUnseen(hasUnseenFiles(lastFoundAt, seenAt, Date.now()));
	}, [classId, lastFoundAt, onFilesPage]);
	return unseen;
}
