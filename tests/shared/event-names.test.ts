/**
 * The event names the window listens for must be the ones the Rust server
 * sends: SERVER_EVENT_TYPES against EventKind::name() in crates/base/src/events.rs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { SERVER_EVENT_TYPES } from "../../src/shared/core/events.ts";

const rust = readFileSync(new URL("../../crates/base/src/events.rs", import.meta.url), "utf-8");

it("the TypeScript event names and the Rust EventKind names are the same set", () => {
	const nameFn = /pub fn name\(self\)[^{]*\{([\s\S]*?)\n\t\}\n/.exec(rust)?.[1] ?? "";
	const inRust = [...nameFn.matchAll(/EventKind::\w+ => "([a-z-]+)"/g)].map((m) => m[1]!);
	assert.ok(inRust.length > 0, "found no names in EventKind::name()");
	const inTs: string[] = [...SERVER_EVENT_TYPES];
	assert.deepEqual(
		inRust.filter((n) => !inTs.includes(n)),
		[],
		"sent by Rust (events.rs) but missing from SERVER_EVENT_TYPES in events.ts",
	);
	assert.deepEqual(
		inTs.filter((n) => !inRust.includes(n)),
		[],
		"in SERVER_EVENT_TYPES in events.ts but never sent by Rust (events.rs)",
	);
});
