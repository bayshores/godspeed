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
 * unrelated to the app release version. Migrations live in the adapter
 * (src/store/settings.ts), not here.
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

import { oneLine, sanitizeAreaRules, type AreaRules } from "./teaching-areas.ts";


/** The schema version this code understands. Bump ONLY when stored records need
 *  upgrading (a field renamed, its meaning or its old default changed); pure
 *  additions never bump. */
export const CURRENT_SETTINGS_VERSION = 2;

/** The outside agent's provider id (MCP bridge, src/agent/agent-bridge.ts) —
 *  the ONLY model provider. Every lesson and background job
 *  runs through the agent that connects over /api/mcp. */
export const OUTSIDE_AGENT_PROVIDER = "agent";
/** The outside agent's one model id (the provider:id stamp on usage). */
export const OUTSIDE_AGENT_MODEL_ID = "outside-agent";
/** The context budget the app plans compaction around (and the lesson's
 *  context meter shows). Claude- and GPT-class agents both hold well over
 *  this; staying modest keeps lessons compact. */
export const OUTSIDE_AGENT_CONTEXT_WINDOW = 200_000;

/** General settings — app-level behavior. Version DISPLAY and plans login
 *  live outside the record (package.json / credential files). */
export interface GeneralSettings {
	/** Automatic startup/24h update checks (default ON). Manual checks bypass this. */
	autoUpdate?: boolean;
	/** The class the window shows: a class id,
	 *  or "none" = No class (the default). */
	activeClass?: string;
	/** First-launch onboarding: true = done or skipped
	 *  (existing users); false = in progress (shown until finished);
	 *  absent = not decided yet (src/server/onboarding.ts decides). */
	onboarded?: boolean;
	/** The newest version whose "What's new" the learner has been shown
	 *  ("0.4.1"). Absent = not recorded yet (src/server/whats-new.ts). */
	lastSeenVersion?: string;
	/** The on-screen teacher's name. Only shown in
	 *  the window; the agent's prompts never use it. Default "Halley". */
	teacherName?: string;
	/** Startup, onboarding and right/wrong answer sounds (default ON). */
	sounds?: boolean;
}

/** The teacher's name when none is set. */
export const DEFAULT_TEACHER_NAME = "Halley";
/** The longest teacher name kept. */
export const TEACHER_NAME_MAX = 40;

/** A teacher name made safe to show. "" = use the default. */
export function sanitizeTeacherName(raw: string): string {
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

/** Markdown-rendering knobs — the bare-bones set. */
export interface MdRenderingSettings {
	/** Heading font weight (100–900, default 900). CSS resolves the nearest
	 *  available weight of the chosen font — no font introspection needed. */
	headingWeight?: number;
	/** Color for **bold** spans (default #ffffff). */
	boldColor?: string | null;
	/** Color for *italic* spans (default #ffffff). */
	italicColor?: string | null;
}

/** Appearance settings — colors, type, markdown emphasis. */
export interface AppearanceSettings {
	/** The one user-chosen color; text, panels and borders derive from it
	 *  in code (dark text on a light one). null = black. */
	background?: string | null;
	/** The main reading font (everything that is Source Sans 3 today), by
	 *  name — user-chosen from installed fonts. null = Source Sans 3. */
	fontFamily?: string | null;
	/** Reading font size in px (12–24, default 16). Headings render as
	 *  multiples of this, so one knob scales the document coherently. */
	proseFontSize?: number;
	/** Session names in CMU Serif (default true — today's look). */
	sessionNameSerif?: boolean;
	mdRendering?: MdRenderingSettings;
}

/** Knowledge-graph settings. */
export interface GraphSettings {
	/** The master switch: off = no extraction. Clustering is
	 *  the free birth-session partition derived on read
	 *  (core/session-clusters.ts), labels ARE session names, and the prober
	 *  graph tools read the ledgers directly — so there is nothing else to
	 *  configure. Data stays stored either way. */
	enabled?: boolean;
	/** The chunk budget: the transcript-token share of the extractor's context — a run fires
	 *  when a chat's UNCOVERED tokens reach it, and the run batches the
	 *  oldest uncovered messages into runs of ≤ this many tokens. It
	 *  bounds both cost and chunk size (the extractor prompt also
	 *  carries the whole graph + instructions, so a smaller budget means
	 *  more, smaller runs — each paying that fixed overhead).
	 *
	 *  FACTORY DEFAULT 4096: the labeled passages + message anchors make
	 *  smaller batches worth their overhead. Only the FACTORY moves: an
	 *  explicit user value always wins.
	 *
	 *  FLOOR 500 (EXTRACTION_CHUNK_TOKENS_FLOOR): every run pays the graph-carrying
	 *  prompt overhead — a budget below ~500 tokens would fire tiny
	 *  batches where the overhead outweighs the content, so the sanitizer
	 *  clamps and the PUT rejects below it. NO CEILING on purpose: a large
	 *  budget just delays extraction, a tradeoff the user may choose. */
	extractionChunkTokens?: number;
}

/**
 * COMPACTION: the context-fitting mechanic's
 * user-facing knob. One number — the trigger threshold in context tokens.
 * The effective trigger is min(this, model contextWindow − 16k reserve):
 * on big models the setting rules; on small ones the
 * window rules before the provider overflows.
 *
 * FACTORY DEFAULT 40_000: the outside agent compacts its own context, and after
 * that the app sends a lesson again in full, so a lesson must stay small.
 *
 * FLOOR 32_000: below
 * the kept tail (20k) + a summary the chat would re-compact every turn —
 * a burn, not a preference. NO CEILING: a huge threshold just means "fit
 * everything" until the window rule binds.
 */
export interface CompactionSettings {
	thresholdTokens?: number;
}

/** THE record. Every section optional (delta); unknown top-level keys are
 *  preserved verbatim by the sanitizer (forward-compat with newer records). */
export interface UserSettings {
	version: number;
	general?: GeneralSettings;
	agent?: AgentSettings;
	appearance?: AppearanceSettings;
	graph?: GraphSettings;
	compaction?: CompactionSettings;
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
		proseFontSize: number;
		sessionNameSerif: boolean;
		mdRendering: {
			headingWeight: number;
			boldColor: string | null;
			italicColor: string | null;
		};
	};
	graph: Required<GraphSettings>;
	compaction: Required<CompactionSettings>;
}

export const FACTORY_SETTINGS: FactorySettings = {
	version: CURRENT_SETTINGS_VERSION,
	general: { autoUpdate: true, activeClass: "none", teacherName: DEFAULT_TEACHER_NAME, sounds: true },
	appearance: {
		background: null, // black
		fontFamily: null, // Source Sans 3
		proseFontSize: 16,
		sessionNameSerif: true,
		mdRendering: { headingWeight: 900, boldColor: null, italicColor: null },
	},
	graph: { enabled: true, extractionChunkTokens: 4096 },
	compaction: { thresholdTokens: 40_000 },
};

/** The chunk budget's validated floor (GraphSettings.extractionChunkTokens
 *  — see its doc for the penny-batch rationale; the settings PUT names this
 *  in its rejection, the sanitizer clamps to it). */
export const EXTRACTION_CHUNK_TOKENS_FLOOR = 500;

// ─── Sanitizer ─────────────────────────────────────────────────────────────

const PROSE_FONT_MIN = 12;
const PROSE_FONT_MAX = 24;

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

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
	if (typeof raw.activeClass === "string" && (raw.activeClass === "none" || /^cls_[A-Za-z0-9_-]+$/.test(raw.activeClass))) {
		out.activeClass = raw.activeClass;
	}
	const onboarded = boolOrDrop(raw.onboarded);
	if (onboarded !== undefined) out.onboarded = onboarded;
	if (typeof raw.lastSeenVersion === "string" && /^\d+\.\d+\.\d+$/.test(raw.lastSeenVersion)) {
		out.lastSeenVersion = raw.lastSeenVersion;
	}
	if (typeof raw.teacherName === "string") {
		const name = sanitizeTeacherName(raw.teacherName);
		if (name) out.teacherName = name;
	}
	const sounds = boolOrDrop(raw.sounds);
	if (sounds !== undefined) out.sounds = sounds;
	return out;
}

function sanitizeBooleanMap(raw: unknown): Record<string, boolean> | undefined {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
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
	if (raw.graphTools !== null && typeof raw.graphTools === "object" && !Array.isArray(raw.graphTools)) {
		const enabled = (raw.graphTools as Record<string, unknown>).enabled;
		if (enabled === undefined) out.graphTools = {};
		else if (typeof enabled === "boolean") out.graphTools = { enabled };
	}
	return out;
}

function sanitizeMdRendering(raw: unknown): MdRenderingSettings {
	const out: MdRenderingSettings = {};
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
	const r = raw as Record<string, unknown>;
	if (typeof r.headingWeight === "number" && Number.isFinite(r.headingWeight)) {
		out.headingWeight = clamp(Math.round(r.headingWeight), 100, 900);
	}
	if (r.boldColor !== undefined) out.boldColor = sanitizeHexOrNull(r.boldColor);
	if (r.italicColor !== undefined) out.italicColor = sanitizeHexOrNull(r.italicColor);
	return out;
}

function sanitizeAppearance(raw: Record<string, unknown>): AppearanceSettings {
	const out: AppearanceSettings = {};
	if (raw.background !== undefined) out.background = sanitizeHexOrNull(raw.background);
	if (raw.fontFamily !== undefined) {
		out.fontFamily = typeof raw.fontFamily === "string" && raw.fontFamily.trim() ? raw.fontFamily : null;
	}
	if (typeof raw.proseFontSize === "number" && Number.isFinite(raw.proseFontSize)) {
		out.proseFontSize = clamp(Math.round(raw.proseFontSize), PROSE_FONT_MIN, PROSE_FONT_MAX);
	}
	const sessionNameSerif = boolOrDrop(raw.sessionNameSerif);
	if (sessionNameSerif !== undefined) out.sessionNameSerif = sessionNameSerif;
	if (raw.mdRendering !== undefined) out.mdRendering = sanitizeMdRendering(raw.mdRendering);
	return out;
}

function sanitizeGraph(raw: Record<string, unknown>): GraphSettings {
	// Dead keys in older records (embedding/clustering/labeling/
	// embeddingModel) are UNREAD and DROPPED by this reconstruction: the
	// next graph-section write (PUT is replace-whole) persists the clean
	// shape, and no active code ever looks at the stale fields.
	//
	// extractionChunkTokens: the chunk budget — clamp-never-reject: a finite
	// positive number floors to EXTRACTION_CHUNK_TOKENS_FLOOR (fractions
	// floor to integers), anything else drops to the factory default at
	// resolution. A disk record below the floor (older app, hand edit)
	// clamps UP — the floor is a cost protection, not data to honor.
	const out: GraphSettings = {};
	const enabled = boolOrDrop(raw.enabled);
	if (enabled !== undefined) out.enabled = enabled;
	const rawTokens = raw.extractionChunkTokens;
	if (typeof rawTokens === "number" && Number.isFinite(rawTokens) && rawTokens > 0) {
		out.extractionChunkTokens = Math.max(EXTRACTION_CHUNK_TOKENS_FLOOR, Math.floor(rawTokens));
	}
	return out;
}

/** clamp-never-reject (the sanitizer's discipline): a finite positive
 *  number floors to COMPACTION_THRESHOLD_FLOOR, anything else drops (the
 *  factory default resolves at read time). Exported for the PUT parser's
 *  reject-with-rationale. */
export const COMPACTION_THRESHOLD_FLOOR = 32_000;

function sanitizeCompaction(raw: Record<string, unknown>): CompactionSettings {
	const out: CompactionSettings = {};
	const rawTokens = raw.thresholdTokens;
	if (typeof rawTokens === "number" && Number.isFinite(rawTokens) && rawTokens > 0) {
		out.thresholdTokens = Math.max(COMPACTION_THRESHOLD_FLOOR, Math.floor(rawTokens));
	}
	return out;
}

/**
 * Coerce arbitrary JSON (disk file, network body) into a valid delta record:
 * known fields validated strictly (invalid ones drop/clamp per module doc),
 * UNKNOWN KEYS PRESERVED VERBATIM (a newer record must survive an older
 * app). Never throws. Non-objects → null.
 */
export function sanitizeUserSettings(raw: unknown): UserSettings | null {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
	const r = raw as Record<string, unknown>;
	const out: UserSettings = {
		version: typeof r.version === "number" && Number.isInteger(r.version) && r.version >= 1 ? r.version : CURRENT_SETTINGS_VERSION,
	};
	if (r.general !== null && typeof r.general === "object" && !Array.isArray(r.general)) {
		out.general = sanitizeGeneral(r.general as Record<string, unknown>);
	}
	if (r.agent !== null && typeof r.agent === "object" && !Array.isArray(r.agent)) {
		out.agent = sanitizeAgent(r.agent as Record<string, unknown>);
	}
	if (r.appearance !== null && typeof r.appearance === "object" && !Array.isArray(r.appearance)) {
		out.appearance = sanitizeAppearance(r.appearance as Record<string, unknown>);
	}
	if (r.graph !== null && typeof r.graph === "object" && !Array.isArray(r.graph)) {
		out.graph = sanitizeGraph(r.graph as Record<string, unknown>);
	}
	if (r.compaction !== null && typeof r.compaction === "object" && !Array.isArray(r.compaction)) {
		out.compaction = sanitizeCompaction(r.compaction as Record<string, unknown>);
	}
	// Unknown top-level keys ride along untouched (forward-compat). Known-
	// DEAD keys are stripped instead of riding: `chat` (a removed default-
	// settings section) and `models` (a removed section) — a fossil copy
	// on disk must never resurrect through reads (and any later write
	// flushes it for good).
	for (const [key, value] of Object.entries(r)) {
		if (key === "chat" || key === "models") continue;
		if (!(key in out)) out[key] = value;
	}
	return out;
}
