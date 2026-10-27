/**
 * THE COMPOSITION ROOT for storage — the single place concrete store
 * adapters are wired. Everything else (core, services, agents) codes against
 * the port types in core/ports.ts and receives instances through this
 * module. Swapping the fs adapter for SQLite later changes exactly this
 * file (and the adapter implementations in src/store/).
 */

import { chatStore } from "../store/chats.ts";
import { classStore } from "../store/classes.ts";
import { createGraphStore, graphStore } from "../store/graph.ts";
import { PATHS, graphFilesIn } from "../../config.ts";
import type { GraphStore } from "../core/ports.ts";
import type { ClassScope } from "../core/contracts.ts";
import { jobStore } from "../store/jobs.ts";
import { settingsStore } from "../store/settings.ts";
import { resolveSettings, type EffectiveSettings } from "../core/settings-resolution.ts";
/** The wired adapters. Satisfies core/graph.ts's GraphDeps structurally. */
export const stores = {
	chatStore,
	/** The "No class" graph (data/graph). Class-aware code goes through
	 *  graphStoreFor(scope) instead. */
	graphStore,
	classStore,
	jobStore,
	settingsStore,
};

/** One adapter per class graph, built on first use (classes wave,
 *  2026-10-26). Adapters are stateless, so caching is only an allocation
 *  saving; a deleted class's entry is dropped by forgetGraphStore. */
const classGraphStores = new Map<string, GraphStore>();

/** The folder a scope's graph family lives in. */
export function graphDirFor(scope: ClassScope): string {
	return scope === null ? PATHS.graph : classStore.graphDir(scope);
}

/** The graph store for a class scope: null = "No class" (data/graph),
 *  a class id = that class's own graph (data/classes/<id>/graph). */
export function graphStoreFor(scope: ClassScope): GraphStore {
	if (scope === null) return graphStore;
	let store = classGraphStores.get(scope);
	if (!store) {
		store = createGraphStore(graphFilesIn(graphDirFor(scope)));
		classGraphStores.set(scope, store);
	}
	return store;
}

/** The graph store a lesson writes to: its class's graph, or "No class". */
export function graphStoreForChat(chatId: string): GraphStore {
	return graphStoreFor(chatStore.getChat(chatId)?.classId ?? null);
}

/** Drop a deleted class's cached adapter. */
export function forgetGraphStore(classId: string): void {
	classGraphStores.delete(classId);
}

/** Every graph scope that exists: "No class" first, then each class
 *  (archived included). The cross-class READ surface (owner ruling: reads
 *  may cross classes, writes never do). */
export function allGraphScopes(): { scope: ClassScope; name: string }[] {
	return [
		{ scope: null, name: "No class" },
		...classStore.listClasses().map((c) => ({ scope: c.id as ClassScope, name: c.name })),
	];
}

export type Stores = typeof stores;

/**
 * The resolved view of the settings record (core/settings-resolution.ts):
 * every knob concrete over its factory default — EXCEPT MODELS (BYOK all
 * the way down, owner 2026-09-22): no factory pins exist, so unset model
 * slots resolve to null and per-need refusal gates fire downstream. Read
 * fresh on every call — the record is a small file and turns are rare, so
 * no caching layer (stale toggles after a settings PUT would be worse).
 */
export function effectiveSettings(): EffectiveSettings {
	return resolveSettings(settingsStore.readSettings());
}
