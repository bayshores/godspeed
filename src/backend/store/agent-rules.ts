/**
 * data/agent-rules.json: which teaching rules an agent saved, and when
 * (core/agent-rules.ts). Read-modify-write; at most one entry per rule.
 */
import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../config.ts";
import { parseSavedRules, type SavedRule } from "../../shared/core/agent-rules.ts";
import { setAsideCorrupt } from "./set-aside.ts";
import { writeFileAtomic } from "./write-file-atomic.ts";

const RULES_FILE = path.join(PATHS.data, "agent-rules.json");
const VERSION = 1;

/** Oldest first. A missing file reads as none; a broken one is set aside. */
export function readSavedRules(): SavedRule[] {
	try {
		return parseSavedRules(JSON.parse(fs.readFileSync(RULES_FILE, "utf8")));
	} catch (err) {
		if (err instanceof SyntaxError) setAsideCorrupt(RULES_FILE);
		return [];
	}
}

export function writeSavedRules(rules: SavedRule[]): void {
	writeFileAtomic(RULES_FILE, JSON.stringify({ version: VERSION, rules }, null, "\t"));
}
