/**
 * Files new to a space: the kind one gets when it arrives, and how long a
 * file a folder scan found counts as new.
 */
import type { SpaceFile, SpaceFileKind } from "./contracts.ts";
import { groupFileSeries } from "./file-series.ts";

/** How long an arrived file counts as new (the Files page's New mark and the
 *  agent's [Today] note). */
export const NEW_FILE_DAYS = 3;
const NEW_FILE_MS = NEW_FILE_DAYS * 86_400_000;

/** How long an added or removed file shows in the Files page's Recent
 *  changes (and a removed one stays on the space record). */
export const RECENT_CHANGE_DAYS = 14;

/** True when the time is within the last RECENT_CHANGE_DAYS. */
export function isRecentChange(at: string, now: number): boolean {
	return now - Date.parse(at) <= RECENT_CHANGE_DAYS * 86_400_000;
}

/** True when the time is within the last NEW_FILE_DAYS. */
export function isRecent(at: string | undefined, now: number): boolean {
	return !!at && now - Date.parse(at) <= NEW_FILE_MS;
}

/** A file a later scan of its linked folder found, in the last few days. */
export function isNewFolderFile(file: Pick<SpaceFile, "foundByScan" | "addedAt">, now: number): boolean {
	return file.foundByScan === true && isRecent(file.addedAt, now);
}

/**
 * The kind a file new to a space gets: the kind of the series it joins
 * (HW5 joins HW1–4, which are space info), when that series' files all
 * share one kind. Otherwise study material.
 */
export function kindsForNewFiles(
	existing: readonly { id: string; name: string; kind: SpaceFileKind }[],
	added: readonly { id: string; name: string }[],
): Map<string, SpaceFileKind> {
	const kinds = new Map<string, SpaceFileKind>(added.map((f) => [f.id, "study"]));
	if (added.length === 0) return kinds;
	const known = new Map(existing.map((f) => [f.id, f.kind]));
	const { series } = groupFileSeries([...existing, ...added]);
	for (const s of series) {
		const members = s.items.flatMap((i) => i.files);
		const old = new Set(members.flatMap((f) => (known.has(f.id) ? [known.get(f.id)!] : [])));
		if (old.size !== 1) continue;
		const [kind] = old;
		for (const f of members) if (kinds.has(f.id)) kinds.set(f.id, kind!);
	}
	return kinds;
}
