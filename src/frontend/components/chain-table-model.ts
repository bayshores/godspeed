import { fuzzyScore, type chainsForSelection, type GraphNode } from "@/shared/core";

/** One chain: premises that lead to a conclusion (a lone fact has none). */
export type ReasoningChain = ReturnType<typeof chainsForSelection>[number];

type ChainSortCol = "name" | "props" | "created";
export interface ChainSort {
	col: ChainSortCol;
	/** 1 = ascending (A to Z, oldest first, smallest first), -1 = descending. */
	dir: 1 | -1;
}

/** The facts born in one lesson or file. A chain belongs where its
 *  conclusion was born, so a premise-only birth never forms a group. */
export interface ClusterGroup {
	key: string;
	label: string | null;
	kind: "chat" | "notes" | null;
	chains: ReasoningChain[];
	nodeIds: string[];
	newestCreatedAt: string;
}

/** The key of the group whose birth can't be named. */
export const UNLABELED = "\0unlabeled";

/** Clicking the sorted column flips it; a new column starts A to Z for
 *  names and biggest or newest first for the others. */
export function nextSort(prev: ChainSort, col: ChainSortCol): ChainSort {
	if (prev.col === col) return { col, dir: prev.dir === 1 ? -1 : 1 };
	return { col, dir: col === "name" ? 1 : -1 };
}

/** The chains with any fact matching the search (name, alias or
 *  statement), best match first. An empty search keeps them all. */
export function matchingChains(chains: readonly ReasoningChain[], byId: ReadonlyMap<string, GraphNode>, query: string): ReasoningChain[] {
	if (query.trim() === "") return [...chains];
	const scored: { chain: ReasoningChain; best: number }[] = [];
	for (const chain of chains) {
		let best: number | null = null;
		for (const id of [...chain.premises, chain.conclusion]) {
			const node = byId.get(id);
			const s = node ? fuzzyScore(query, node.name, node.statement, ...node.aliases) : null;
			if (s !== null && (best === null || s > best)) best = s;
		}
		if (best !== null) scored.push({ chain, best });
	}
	return scored.sort((a, b) => b.best - a.best || (a.chain.id < b.chain.id ? -1 : 1)).map((r) => r.chain);
}

/** The chains grouped by their conclusion's birth, groups and the chains
 *  in each ordered by `sort` (name breaks ties). The unnamed group always
 *  comes last. */
export function groupChains(
	chains: readonly ReasoningChain[],
	byId: ReadonlyMap<string, GraphNode>,
	sessions: Record<string, string>,
	fileSources: Record<string, string>,
	sort: ChainSort,
): ClusterGroup[] {
	const map = new Map<string, ClusterGroup>();
	for (const chain of chains) {
		const birth = byId.get(chain.conclusion)?.provenance[0]?.chatId ?? null;
		const key = birth ?? UNLABELED;
		let group = map.get(key);
		if (!group) {
			const chat = birth === null ? undefined : sessions[birth];
			const file = birth === null ? undefined : fileSources[birth];
			group = { key, label: chat ?? file ?? null, kind: chat !== undefined ? "chat" : file !== undefined ? "notes" : null, chains: [], nodeIds: [], newestCreatedAt: "" };
			map.set(key, group);
		}
		group.chains.push(chain);
		for (const id of [...chain.premises, chain.conclusion]) {
			if (!group.nodeIds.includes(id)) group.nodeIds.push(id);
			const createdAt = byId.get(id)?.createdAt ?? "";
			if (createdAt > group.newestCreatedAt) group.newestCreatedAt = createdAt;
		}
	}
	const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
	const order = <T>(name: (x: T) => string | null, size: (x: T) => number, date: (x: T) => string) => (a: T, b: T) => {
		const na = name(a);
		const nb = name(b);
		const byName = Number(na === null) - Number(nb === null) || collator.compare(na ?? "", nb ?? "") * (sort.col === "name" ? sort.dir : 1);
		if (sort.col === "props") return (size(a) - size(b)) * sort.dir || byName;
		if (sort.col === "created") return date(a).localeCompare(date(b)) * sort.dir || byName;
		return byName;
	};
	const list = [...map.values()].sort(
		order<ClusterGroup>(
			(g) => g.label,
			(g) => g.nodeIds.length,
			(g) => g.newestCreatedAt,
		),
	);
	for (const group of list) {
		group.chains.sort(
			order<ReasoningChain>(
				(c) => byId.get(c.conclusion)?.name ?? c.conclusion,
				(c) => c.premises.length + 1,
				(c) => byId.get(c.conclusion)?.createdAt ?? "",
			),
		);
	}
	return list;
}

/** A box over several facts is ticked when all are picked and half
 *  ticked when some are. */
export function tickState(ids: readonly string[], picked: ReadonlySet<string>): { checked: boolean; mixed: boolean } {
	const n = ids.filter((id) => picked.has(id)).length;
	return { checked: n > 0 && n === ids.length, mixed: n > 0 && n < ids.length };
}

/** `picked` with `ids` added (next) or taken out. */
export function withIds(picked: ReadonlySet<string>, ids: readonly string[], next: boolean): Set<string> {
	const s = new Set(picked);
	for (const id of ids) {
		if (next) s.add(id);
		else s.delete(id);
	}
	return s;
}

/** `set` with `id` flipped in or out. */
export function toggled(set: ReadonlySet<string>, id: string): Set<string> {
	const s = new Set(set);
	if (s.has(id)) s.delete(id);
	else s.add(id);
	return s;
}

/** A file group shows the file's own name, not its folders. */
export function groupName(group: Pick<ClusterGroup, "label" | "kind">): string | null {
	return group.kind === "notes" && group.label ? group.label.split(/[\\/]/).pop()! : group.label;
}

export const factCount = (n: number) => `${n} ${n === 1 ? "fact" : "facts"}`;

/** "221 facts in CSE 21" under the title. */
export function countLine(n: number, spaceName: string | null): string {
	return spaceName ? `${factCount(n)} in ${spaceName}` : factCount(n);
}
