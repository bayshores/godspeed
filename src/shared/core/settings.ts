/**
 * THE USER SETTINGS RECORD's shape: one versioned, DELTA-shaped record
 * holding every non-secret product preference. The Rust server reads, cleans
 * and saves it (crates/core/src/records/settings.rs).
 *
 * DELTA SEMANTICS: the record stores EXPLICIT user choices only. ABSENT keys
 * resolve to the factory defaults (FACTORY_SETTINGS). A software update that
 * ADDS a knob therefore needs no migration: old records simply lack the new
 * keys. `version` is a PRIVATE schema counter for changes stored records must
 * be upgraded for (CURRENT_SETTINGS_VERSION), unrelated to the app release
 * version. The resolved (fully concrete) view lives in settings-resolution.ts.
 */

import type { AreaRules } from "./teaching-areas.ts";

/** The schema version this code understands. Bump ONLY when stored records need
 *  upgrading (a field renamed, its meaning or its old default changed); pure
 *  additions never bump. */
export const CURRENT_SETTINGS_VERSION = 3;

/** General settings — app-level behavior. Version DISPLAY and plans login
 *  live outside the record (package.json / credential files). */
export interface GeneralSettings {
	/** Automatic startup/24h update checks (default ON). Manual checks bypass this. */
	autoUpdate?: boolean;
	/** The space the window shows: a space id,
	 *  or "none" = No space (the default). */
	activeSpace?: string;
	/** First-launch onboarding: true = done or skipped
	 *  (existing users); false = in progress (shown until finished);
	 *  absent = not decided yet (the server decides). */
	onboarded?: boolean;
	/** The newest version whose "What's new" the learner has been shown
	 *  ("0.4.1"). Absent = not recorded yet. */
	lastSeenVersion?: string;
	/** The on-screen teacher's name. Only shown in
	 *  the window; the agent's prompts never use it. Default "Teacher". */
	teacherName?: string;
	/** The welcome screen's sound on each launch (default ON). */
	startupSound?: boolean;
	/** Onboarding, right/wrong answer and teacher-done sounds (default ON). */
	sounds?: boolean;
	/** One system notification a day for a deadline 3 days away or less (default ON). */
	deadlineReminders?: boolean;
}

/** The teacher's name when none is set. */
export const DEFAULT_TEACHER_NAME = "Teacher";
/** Agent settings — everything about the non-conversation machinery. */
export interface AgentSettings {
	/** Tool toggles keyed by tool id (absent key = enabled). User-level
	 *  only — no per-chat override. */
	tools?: Record<string, boolean>;
	/** Prober graph tools: read-only
	 *  knowledge-graph views for the prober agent — a session list +
	 *  per-session propositions with understanding levels. Its SUBJECT
	 *  is the graph but its MECHANISM is agent capability (tool
	 *  registration), so it lives here in its OWN subsection, not in the
	 *  tool-toggles map. Absent = enabled (the toggle discipline); the
	 *  effective gate composes graph.enabled AND this switch. */
	graphTools?: { enabled?: boolean };
	/** The learner's rules per teaching area, added to every agent's prompt. */
	rules?: AreaRules;
}

/** Appearance settings: the background and the reading font. Heading
 *  weight and bold and italic colors (`mdRendering`) and the reading size
 *  (`proseFontSize`) are no longer read. */
export interface AppearanceSettings {
	/** The one user-chosen color; text, panels and borders derive from it
	 *  in code. null = Paper, the light default. */
	background?: string | null;
	/** The reading font by name, user-chosen from installed fonts.
	 *  null = Literata. */
	fontFamily?: string | null;
}

/** Knowledge-graph settings. */
export interface GraphSettings {
	/** The master switch: off = no extraction. Clustering is
	 *  the free birth-session partition derived on read
	 *  and labels are session names. The prober
	 *  graph tools read the ledgers directly — so there is nothing else to
	 *  configure. Data stays stored either way. The chunk budget
	 *  (`extractionChunkTokens`) is fixed by the server, which ignores a saved one. */
	enabled?: boolean;
}

/** One installed plugin's switch (absent = on) and the values set for its
 *  manifest's settings, keyed by the plugin's id. */
interface PluginSettings {
	enabled?: boolean;
	values?: Record<string, boolean | number | string>;
}

/** THE record. Every section optional (delta); unknown top-level keys are
 *  preserved verbatim by the sanitizer (forward-compat with newer records). */
export interface UserSettings {
	version: number;
	general?: GeneralSettings;
	agent?: AgentSettings;
	appearance?: AppearanceSettings;
	graph?: GraphSettings;
	plugins?: Record<string, PluginSettings>;
	[key: string]: unknown;
}

/** Factory defaults for everything core can pin. Tools default on and
 *  rules default empty, hence their absence here. */
/** The factory layer as this side reads it. The server's also holds
 *  graph.extractionChunkTokens and compaction.thresholdTokens: fixed numbers only the server uses. */
export interface FactorySettings {
	version: number;
	general: Required<Omit<GeneralSettings, "onboarded" | "lastSeenVersion">>;
	appearance: {
		background: string | null;
		fontFamily: string | null;
	};
	graph: Required<GraphSettings>;
}

export const FACTORY_SETTINGS: FactorySettings = {
	version: CURRENT_SETTINGS_VERSION,
	general: { autoUpdate: true, activeSpace: "none", teacherName: DEFAULT_TEACHER_NAME, startupSound: true, sounds: true, deadlineReminders: true },
	appearance: {
		background: null, // Paper
		fontFamily: null, // Literata
	},
	graph: { enabled: true },
};
