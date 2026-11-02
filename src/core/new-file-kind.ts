/**
 * The kind a file new to a class gets: the kind of the series it joins
 * (HW5 joins HW1–4, which are course info), when that series' files all
 * share one kind. Otherwise study material, as before.
 */
import type { ClassFileKind } from "./contracts.ts";
import { groupFileSeries } from "./file-series.ts";

export function kindsForNewFiles(
	existing: readonly { id: string; name: string; kind: ClassFileKind }[],
	added: readonly { id: string; name: string }[],
): Map<string, ClassFileKind> {
	const kinds = new Map<string, ClassFileKind>(added.map((f) => [f.id, "study"]));
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
