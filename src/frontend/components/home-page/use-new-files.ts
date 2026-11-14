/**
 * Today's new-files lines. Only a space whose linked folder brought files
 * the learner hasn't seen on its Files page (the summary's lastFoundAt
 * says so) has its record read (GET /api/spaces/:id), so most visits read
 * nothing. A failed read shows no line.
 */
import { useEffect, useState } from "react";
import type { SpaceRecord, SpaceSummary } from "@/shared/core";
import { filesSeenAt, hasUnseenFiles } from "@/frontend/components/files/files-seen";
import { newFilesLine } from "./space-list-model";

const NONE: ReadonlyMap<string, string> = new Map();

/** `settled`: every read for the spaces as they are now is back. Until
 *  then `lines` holds the last ones. */
export function useNewFiles(spaces: readonly SpaceSummary[]): { lines: ReadonlyMap<string, string>; settled: boolean } {
	const key = spaces.map((s) => `${s.id}@${s.lastFoundAt ?? ""}`).join(",");
	const [state, setState] = useState<{ key: string; lines: ReadonlyMap<string, string> } | null>(null);

	useEffect(() => {
		let alive = true;
		const now = Date.now();
		const unseen = spaces.flatMap((s) => {
			const seenAt = filesSeenAt(s.id);
			return hasUnseenFiles(s.lastFoundAt, seenAt, now) ? [{ id: s.id, seenAt }] : [];
		});
		void Promise.all(
			unseen.map(async ({ id, seenAt }): Promise<[string, string] | null> => {
				try {
					const res = await fetch(`/api/spaces/${encodeURIComponent(id)}`, { cache: "no-store" });
					if (!res.ok) return null;
					const { space } = (await res.json()) as { space: SpaceRecord };
					const line = newFilesLine(space.files, seenAt, Date.now());
					return line ? [id, line] : null;
				} catch {
					return null;
				}
			}),
		).then((found) => {
			if (alive) setState({ key, lines: new Map(found.filter((f) => f !== null)) });
		});
		return () => {
			alive = false;
		};
		// `key` holds every field of `spaces` this reads.
	}, [key]);

	return { lines: state?.lines ?? NONE, settled: state?.key === key };
}
