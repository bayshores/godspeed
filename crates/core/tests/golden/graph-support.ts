// Helpers for graph.golden.ts: the ledger fixtures, an in-memory GraphStore (the Rust test has the
// same one), digest marks for big outputs, and the id/time normaliser for merge runs.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { GraphStore } from "../../../../src/shared/core/ports.ts";

export interface Ledgers {
	nodes: any[];
	chains: any[];
	coverage: any[];
	checkpoints: any[];
	sources: any[];
	chats: any[];
	topics: any[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, "../fixtures/graph");

export const emptyLedgers = (): Ledgers => ({ nodes: [], chains: [], coverage: [], checkpoints: [], sources: [], chats: [], topics: [] });

export function ledgers(parts: Partial<Ledgers>): Ledgers {
	return { ...emptyLedgers(), ...parts };
}

const jsonl = (file: string): any[] =>
	fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];

/** The fixture ledgers of one space graph (never written). */
export function fixture(name: string): Ledgers {
	const dir = path.join(FIXTURES, name);
	return {
		nodes: jsonl(path.join(dir, "nodes.jsonl")),
		chains: jsonl(path.join(dir, "chains.jsonl")),
		coverage: jsonl(path.join(dir, "coverage.jsonl")),
		checkpoints: jsonl(path.join(dir, "sessions.jsonl")),
		sources: JSON.parse(fs.readFileSync(path.join(dir, "sources.json"), "utf8")),
		chats: JSON.parse(fs.readFileSync(path.join(FIXTURES, "chats.json"), "utf8")),
		topics: jsonl(path.join(dir, "topics.jsonl")),
	};
}

export const transcript = (id: string): any[] => JSON.parse(fs.readFileSync(path.join(FIXTURES, "transcripts", `${id}.json`), "utf8"));

/** The golden's `input` for a case: the fixture's name, or the ledgers themselves. */
export const fixtureInput = (name: string) => ({ fixture: name });

export const sha = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** A big output as its digest (the Rust side hashes its own JSON text the same way). */
export const big = (value: unknown) => ({ $sha: sha(value), $len: Array.isArray(value) ? value.length : Object.keys(value as object).length });

const WRITE_ORDER = ["nodes", "chains", "coverage", "checkpoints"] as const;

/** A GraphStore over copied arrays. `rewrites` logs which ledgers each rewrite replaced. */
export function memoryStore(start: Ledgers) {
	const state = structuredClone(start);
	const rewrites: string[][] = [];
	const store = {
		appendNode: (n: any) => void state.nodes.push(structuredClone(n)),
		readNodes: () => structuredClone(state.nodes),
		appendChain: (c: any) => void state.chains.push(structuredClone(c)),
		readChains: () => structuredClone(state.chains),
		appendCheckpoint: (c: any) => void state.checkpoints.push(structuredClone(c)),
		readCheckpoints: () => structuredClone(state.checkpoints),
		appendCoverage: (e: any) => void state.coverage.push(structuredClone(e)),
		readCoverage: () => structuredClone(state.coverage),
		readSources: () => structuredClone(state.sources),
		removeSource: (id: string) => {
			const at = state.sources.findIndex((s) => s.id === id);
			if (at < 0) return false;
			state.sources.splice(at, 1);
			return true;
		},
		rewriteLedgers: (next: Partial<Record<(typeof WRITE_ORDER)[number], any[]>>) => {
			rewrites.push(WRITE_ORDER.filter((key) => next[key] !== undefined));
			for (const key of WRITE_ORDER) if (next[key] !== undefined) state[key] = structuredClone(next[key]!);
		},
	};
	return { store: store as unknown as GraphStore, state, rewrites };
}

export const chatListing = (chats: any[]) => ({ listChats: () => chats });

/** The ledgers a run left, as digests (or whole, for small hand-made ones). */
export function ledgerMarks(state: Ledgers, whole: boolean) {
	const pick = (v: any[]) => (whole ? v : big(v));
	return { nodes: pick(state.nodes), chains: pick(state.chains), coverage: pick(state.coverage), checkpoints: pick(state.checkpoints), sources: pick(state.sources) };
}

const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const FRESH_ID = /^(n|arg)_[0-9a-f]{12}$/;

/** Every string value anywhere in a value (keys are not ids). */
export function stringsOf(value: unknown, out = new Set<string>()): Set<string> {
	if (typeof value === "string") out.add(value);
	else if (Array.isArray(value)) for (const v of value) stringsOf(v, out);
	else if (value && typeof value === "object") for (const v of Object.values(value)) stringsOf(v, out);
	return out;
}

/** Random ids and run times differ per run: ids the inputs did not hold become `<n|arg>_NEW<k>` in order
 *  of first appearance, new times become "NOW". */
export function normalise<T>(value: T, known: Set<string>): T {
	const fresh = new Map<string, string>();
	const counts: Record<string, number> = {};
	const walk = (v: any): any => {
		if (typeof v === "string") {
			if (known.has(v)) return v;
			if (ISO.test(v)) return "NOW";
			const m = FRESH_ID.exec(v);
			if (!m) return v;
			if (!fresh.has(v)) fresh.set(v, `${m[1]}_NEW${(counts[m[1]!] = (counts[m[1]!] ?? 0) + 1)}`);
			return fresh.get(v);
		}
		if (Array.isArray(v)) return v.map(walk);
		if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
		return v;
	};
	return walk(value);
}

/** Runs one step and keeps a thrown message as the result, like the Rust side's Err. */
export function attempt<T>(run: () => T): T | { error: string } {
	try {
		return run();
	} catch (err) {
		return { error: err instanceof Error ? err.message : String(err) };
	}
}
