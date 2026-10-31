/**
 * data/agent-rules.json: which teaching rules an agent saved, and when
 * (core/agent-rules.ts). Read-modify-write; at most one entry per rule.
 */
import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../config.ts";
import { parseSavedRules, type SavedRule } from "../core/agent-rules.ts";
import { writeFileAtomic } from "./write-file-atomic.ts";

const RULES_FILE = path.join(PATHS.data, "agent-rules.json");
const VERSION = 1;

/** Oldest first. A missing or unreadable file reads as none. */
export function readSavedRules(): SavedRule[] {
	try {
		return parseSavedRules(JSON.parse(fs.readFileSync(RULES_FILE, "utf8")));
	} catch {
		return [];
	}
}

export function writeSavedRules(rules: SavedRule[]): void {
	writeFileAtomic(RULES_FILE, JSON.stringify({ version: VERSION, rules }, null, "\t"));
}
