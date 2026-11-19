/**
 * THE USER SETTINGS RECORD's shape + sanitizer: one versioned, DELTA-shaped
 * record at the data-dir seam (config.SETTINGS_FILE) holding every
 * non-secret product preference.
 *
 * DELTA SEMANTICS: the record stores EXPLICIT
 * user choices only — ABSENT keys resolve to the factory defaults compiled
 * into this module (FACTORY_SETTINGS). There are no model settings: the
 * outside agent (MCP) is the only model. A
 * software update that ADDS a knob (new
 * tool, new role, new appearance field) therefore needs no migration: old
 * records simply lack the new keys. `version` is a PRIVATE schema counter
 * for changes stored records must be upgraded for (CURRENT_SETTINGS_VERSION),
 * unrelated to the app release version. Migrations live in the server, not here.
 *
 * Sanitizer contract: whatever
 * arrives from disk or the network passes through sanitizeUserSettings
 * before use — never trusted raw. Strict on known fields, PRESERVES
 * unknown keys verbatim (a newer record must never be destroyed by an
 * older app reading it). Invalid known values degrade gracefully:
 * out-of-range numbers CLAMP, wrong-typed/invalid fields DROP (resolve to
 * factory default), never throw.
 *
 * Browser-safe: pure logic + types only, no node imports. The resolved
 * (fully concrete) view lives in settings-resolution.ts.
 */

import { isVersion } from "./changelog.ts";
import { isSpaceId } from "./contracts/space.ts";
import { isRecord } from "./is-record.ts";
import { oneLine, sanitizeAreaRules, type AreaRules } from "./teaching-areas.ts";

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
/** The longest teacher name kept. */
const TEACHER_NAME_MAX = 40;

/** A teacher name made safe to show. "" = use the default. */
function sanitizeTeacherName(raw: string): string {
	return oneLine(raw, TEACHER_NAME_MAX);
}

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
	 *  configure. Data stays stored either way. The chunk budget an older
	 *  version kept here (`extractionChunkTokens`) is no longer read. */
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

// ─── Sanitizer ─────────────────────────────────────────────────────────────

/** #rgb / #rrggbb (case-insensitive) — the only color format we accept. */
export function isHexColor(value: string): boolean {
	return /^#[0-9a-fA-F]{3}$/.test(value) || /^#[0-9a-fA-F]{6}$/.test(value);
}

/** Coerce an arbitrary hex-or-null field: null and valid hex pass through,
 *  anything else becomes null (the factory default). */
function sanitizeHexOrNull(value: unknown): string | null {
	if (value === null) return null;
	if (typeof value === "string" && isHexColor(value)) return value;
	return null;
}

const boolOrDrop = (value: unknown): boolean | undefined =>
	typeof value === "boolean" ? value : undefined;

function sanitizeGeneral(raw: Record<string, unknown>): GeneralSettings {
	const out: GeneralSettings = {};
	const autoUpdate = boolOrDrop(raw.autoUpdate);
	if (autoUpdate !== undefined) out.autoUpdate = autoUpdate;
	if (raw.activeSpace === "none" || isSpaceId(raw.activeSpace)) {
		out.activeSpace = raw.activeSpace;
	}
	const onboarded = boolOrDrop(raw.onboarded);
	if (onboarded !== undefined) out.onboarded = onboarded;
	if (isVersion(raw.lastSeenVersion)) {
		out.lastSeenVersion = raw.lastSeenVersion;
	}
	if (typeof raw.teacherName === "string") {
		const name = sanitizeTeacherName(raw.teacherName);
		if (name) out.teacherName = name;
	}
	const startupSound = boolOrDrop(raw.startupSound);
	if (startupSound !== undefined) out.startupSound = startupSound;
	const sounds = boolOrDrop(raw.sounds);
	if (sounds !== undefined) out.sounds = sounds;
	const deadlineReminders = boolOrDrop(raw.deadlineReminders);
	if (deadlineReminders !== undefined) out.deadlineReminders = deadlineReminders;
	return out;
}

function sanitizeBooleanMap(raw: unknown): Record<string, boolean> | undefined {
	if (!isRecord(raw)) return undefined;
	const out: Record<string, boolean> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (typeof value === "boolean") out[key] = value;
	}
	return Object.keys(out).length ? out : undefined;
}

function sanitizeAgent(raw: Record<string, unknown>): AgentSettings {
	const out: AgentSettings = {};
	const tools = sanitizeBooleanMap(raw.tools);
	if (tools) out.tools = tools;
	const rules = sanitizeAreaRules(raw.rules);
	if (Object.keys(rules).length) out.rules = rules;
	// Prober graph tools: its own agent-section subsection —
	// lenient read side (a bad shape drops the key and the default ON
	// resumes; the write side's parser is strict).
	if (isRecord(raw.graphTools)) {
		const enabled = raw.graphTools.enabled;
		if (enabled === undefined) out.graphTools = {};
		else if (typeof enabled === "boolean") out.graphTools = { enabled };
	}
	return out;
}

function sanitizeAppearance(raw: Record<string, unknown>): AppearanceSettings {
	const out: AppearanceSettings = {};
	// The two light colors older versions offered read as Paper.
	if (raw.background !== undefined) {
		const background = sanitizeHexOrNull(raw.background);
		out.background = ["#f4f1ea", "#ffffff"].includes(background?.toLowerCase() ?? "") ? null : background;
	}
	if (raw.fontFamily !== undefined) {
		out.fontFamily = typeof raw.fontFamily === "string" && raw.fontFamily.trim() ? raw.fontFamily : null;
	}
	return out;
}

function sanitizeGraph(raw: Record<string, unknown>): GraphSettings {
	// Dead keys in older records (embedding/clustering/labeling/
	// embeddingModel, extractionChunkTokens) are UNREAD and DROPPED by this
	// reconstruction: the next graph-section write (PUT is replace-whole)
	// persists the clean shape.
	const out: GraphSettings = {};
	const enabled = boolOrDrop(raw.enabled);
	if (enabled !== undefined) out.enabled = enabled;
	return out;
}

/**
 * Coerce arbitrary JSON (disk file, network body) into a valid delta record:
 * known fields validated strictly (invalid ones drop per module doc),
 * UNKNOWN KEYS PRESERVED VERBATIM (a newer record must survive an older
 * app). Never throws. Non-objects → null.
 */
export function sanitizeUserSettings(raw: unknown): UserSettings | null {
	if (!isRecord(raw)) return null;
	const r = raw;
	const out: UserSettings = {
		version: typeof r.version === "number" && Number.isInteger(r.version) && r.version >= 1 ? r.version : CURRENT_SETTINGS_VERSION,
	};
	if (isRecord(r.general)) {
		out.general = sanitizeGeneral(r.general);
	}
	if (isRecord(r.agent)) {
		out.agent = sanitizeAgent(r.agent);
	}
	if (isRecord(r.appearance)) {
		out.appearance = sanitizeAppearance(r.appearance);
	}
	if (isRecord(r.graph)) {
		out.graph = sanitizeGraph(r.graph);
	}
	// Unknown top-level keys ride along untouched (forward-compat). Removed
	// sections (`chat`, `models`, `compaction`) are hidden from the window,
	// so no page can read a value nothing uses any more.
	for (const [key, value] of Object.entries(r)) {
		if (key === "chat" || key === "models" || key === "compaction") continue;
		if (!(key in out)) out[key] = value;
	}
	return out;
}
