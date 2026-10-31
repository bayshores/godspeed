/**
 * Server-side persistence for THE user settings record:
 * data/settings.json (config.SETTINGS_FILE), under the
 * LH_DATA_DIR seam — read-modify-write, NOT a ledger. Non-secret product
 * preferences only.
 *
 * This adapter OWNS the lazy migrations:
 *  1. schema-version bumps (CURRENT_SETTINGS_VERSION): v1 → v2 moves the
 *     old summarize threshold default to the new one. Pure additions never
 *     bump, so an up-to-date file is always a no-op pass-through.
 *  2. the retired prompt switches (dropPromptSwitches).
 *
 * Everything off disk is sanitized (core/settings.ts) before it reaches a
 * caller; everything written was already validated by the routes
 * (settings-body.ts) and is sanitized here again — the file can never hold
 * a value that would silently shift a knob.
 */

import fs from "node:fs";
import { SETTINGS_FILE } from "../config.ts";
import {
	sanitizeUserSettings,
	type UserSettings,
} from "../core/settings.ts";
import type { SettingsStore } from "../core/ports.ts";
import { promptOverrides } from "./prompt-overrides.ts";
import { writeFileAtomic } from "./write-file-atomic.ts";

/** The persisted record, or null when none exists (first boot). Runs the
 *  migration chain on every read — cheap: a no-op file check when current. */
export function readSettings(): UserSettings | null {
	let raw: string;
	try {
		raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
	} catch {
		return null; // no settings.json yet — first boot, all factory defaults
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null; // corrupt → first-boot semantics (all factory defaults)
	}
	const record = sanitizeUserSettings(parsed);
	if (!record) return null;
	// Unknown NEWER versions pass through untouched (the sanitizer preserved unknowns).
	const upgraded = upgradeToV2(record);
	if (dropPromptSwitches(parsed) || upgraded) writeSettings(record);
	return record;
}

/** v1 → v2: the summarize threshold's default dropped from 150k to 40k tokens, so a
 *  record still holding the old default takes the new one. True when the file needs
 *  saving; a bare version bump waits for the next write, so plain reads stay reads. */
function upgradeToV2(record: UserSettings): boolean {
	if (record.version >= 2) return false;
	record.version = 2;
	if (record.compaction?.thresholdTokens !== 150_000) return false;
	delete record.compaction.thresholdTokens;
	return true;
}

/** Prompt parts used to have an on/off switch; now a saved version is
 *  always in use. A saved version that was switched off is deleted so
 *  nothing turns on by surprise. True when the old switch map was there
 *  (the caller rewrites the record without it). */
function dropPromptSwitches(parsed: unknown): boolean {
	const switches = (parsed as { agent?: { prompts?: unknown } }).agent?.prompts;
	if (switches === null || typeof switches !== "object") return false;
	for (const segment of promptOverrides.listOverrides()) {
		if ((switches as Record<string, unknown>)[segment] !== true) promptOverrides.deleteOverride(segment);
	}
	return true;
}

/** Persist the record (sanitized). Returns what was written. */
export function writeSettings(raw: unknown): UserSettings {
	const settings = sanitizeUserSettings(raw);
	if (!settings) throw new Error("settings record must be a JSON object");
	writeFileAtomic(SETTINGS_FILE, JSON.stringify(settings, null, "\t"));
	return settings;
}

/** The typed adapter (core/ports.ts SettingsStore), for the composition root. */
export const settingsStore: SettingsStore = {
	readSettings,
	writeSettings,
};
