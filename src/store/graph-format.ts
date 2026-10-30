/**
 * The graph-family FORMAT STAMP:
 * data/graph/format.json — one sidecar versioning the whole graph dir
 * family (the JSONL ledgers and sources.json).
 * JSONL ledgers can't carry inline stamps without per-line bloat, and the
 * JSON files share the family's fate, so the stamp lives beside them.
 *
 * The contract:
 *  - LAZY v1: NO sidecar = v1 (the pre-stamp world stays valid forever);
 *    the first graph-family WRITE creates it. Reads never write.
 *  - Honest refusal: a sidecar stamped
 *    NEWER than this build (the downgrade scenario — user reverted the
 *    app) makes graph-family reads THROW. Read-modify-write stores must
 *    never rewrite what they don't understand; a ledger store must never
 *    silently skip lines it can't interpret as current-format data.
 *
 * Version constants: contracts/graph.ts CURRENT_GRAPH_FORMAT_VERSION.
 *
 * Each graph family (the "No class" graph and
 * every class's own graph) carries its own sidecar — the functions take
 * the family's format file, defaulting to the "No class" one.
 */

import fs from "node:fs";
import path from "node:path";
import { GRAPH_FORMAT_FILE } from "../config.ts";
import { CURRENT_GRAPH_FORMAT_VERSION } from "../core/contracts/graph.ts";

function stampedVersion(file: string): number | null {
	let raw: string;
	try {
		raw = fs.readFileSync(file, "utf-8");
	} catch {
		return null; // no sidecar — the lazy-v1 pre-stamp world
	}
	try {
		const parsed = JSON.parse(raw) as { version?: unknown };
		return typeof parsed.version === "number" && Number.isInteger(parsed.version) ? parsed.version : null;
	} catch {
		return null; // corrupt sidecar reads as unstamped (v1), not fatal
	}
}

/** READ-SIDE GUARD: throws when the data dir was written by a NEWER build.
 *  Called by every graph-family read — never writes (the golden fixtures
 *  pin reads as byte-identical). */
export function assertGraphFormat(file: string = GRAPH_FORMAT_FILE): void {
	const v = stampedVersion(file);
	if (v !== null && v > CURRENT_GRAPH_FORMAT_VERSION) {
		throw new Error(
			`Graph data is stamped with format version ${v}, but this build understands only ${CURRENT_GRAPH_FORMAT_VERSION}. ` +
				"This version of godspeed is older than your data. Update the app to open your graph.",
		);
	}
}

/** WRITE-SIDE STAMP: creates the sidecar on the first graph-family write
 *  (lazy); afterwards a no-op existence-wise. Callers keep their own mkdir. */
export function ensureGraphFormat(file: string = GRAPH_FORMAT_FILE): void {
	if (stampedVersion(file) !== null) return;
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify({ version: CURRENT_GRAPH_FORMAT_VERSION }, null, "\t") + "\n", "utf-8");
}
