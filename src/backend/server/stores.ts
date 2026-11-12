/**
 * THE COMPOSITION ROOT for storage — the single place concrete store
 * adapters are wired. Everything else (core, services, agents) codes against
 * the port types in core/ports.ts and receives instances through this
 * module. Swapping the fs adapter for SQLite later changes exactly this
 * file (and the adapter implementations in src/backend/store/).
 */

import { agentSeenStore } from "../store/agent-seen.ts";
import { setSeenStore } from "../agent/agent-bridge.ts";
import { chatStore } from "../store/chats.ts";
import { spaceStore } from "../store/spaces.ts";
import { createGraphStore, forgetLedgers, graphStore } from "../store/graph.ts";
import { PATHS, graphFilesIn } from "../config.ts";
import type { GraphStore } from "../../shared/core/ports.ts";
import type { SpaceScope } from "../../shared/core/contracts.ts";
import { jobStore } from "../store/jobs.ts";
import { settingsStore } from "../store/settings.ts";
import { resolveSettings, type EffectiveSettings } from "../../shared/core/settings-resolution.ts";
/** The wired adapters. Satisfies core/graph.ts's GraphDeps structurally. */
export const stores = {
	chatStore,
	/** The "No space" graph (data/graph). Space-aware code goes through
	 *  graphStoreFor(scope) instead. */
	graphStore,
	spaceStore,
	jobStore,
	settingsStore,
};

setSeenStore(agentSeenStore);

/** One adapter per space graph, built on first use. Adapters are
 *  stateless, so caching is only an allocation saving; a deleted space's
 *  entry is dropped by forgetGraphStore. */
const spaceGraphStores = new Map<string, GraphStore>();

/** The folder a scope's graph family lives in. */
export function graphDirFor(scope: SpaceScope): string {
	return scope === null ? PATHS.graph : spaceStore.graphDir(scope);
}

/** The graph store for a space scope: null = "No space" (data/graph),
 *  a space id = that space's own graph (data/spaces/<id>/graph). */
export function graphStoreFor(scope: SpaceScope): GraphStore {
	if (scope === null) return graphStore;
	let store = spaceGraphStores.get(scope);
	if (!store) {
		store = createGraphStore(graphFilesIn(graphDirFor(scope)));
		spaceGraphStores.set(scope, store);
	}
	return store;
}

/** Which scope an adapter from graphStoreFor belongs to (null = "No
 *  space"); undefined for an adapter this module did not build. */
export function scopeOfGraphStore(store: GraphStore): SpaceScope | undefined {
	if (store === graphStore) return null;
	for (const [scope, candidate] of spaceGraphStores) if (candidate === store) return scope;
	return undefined;
}

/** The graph store a lesson writes to: its space's graph, or "No space". */
export function graphStoreForChat(chatId: string): GraphStore {
	return graphStoreFor(chatStore.getChat(chatId)?.spaceId ?? null);
}

/** Drop a deleted space's cached adapter and parsed ledgers. */
export function forgetGraphStore(spaceId: string): void {
	spaceGraphStores.delete(spaceId);
	forgetLedgers(graphFilesIn(graphDirFor(spaceId)));
}

/** Every graph scope that exists: "No space" first, then each space
 *  (archived included). The cross-space READ surface: reads may cross
 *  spaces, writes never do. */
export function allGraphScopes(): { scope: SpaceScope; name: string }[] {
	return [
		{ scope: null, name: "No space" },
		...spaceStore.listSpaces().map((c) => ({ scope: c.id as SpaceScope, name: c.name })),
	];
}

/**
 * The resolved view of the settings record (core/settings-resolution.ts):
 * every knob concrete over its factory default. Read fresh on every call:
 * the record is a small file and turns are rare, so no caching layer
 * (stale toggles after a settings PUT would be worse).
 */
export function effectiveSettings(): EffectiveSettings {
	return resolveSettings(settingsStore.readSettings());
}
