/**
 * THE USER SETTINGS RECORD's shape + sanitizer (settings-storage wave,
 * 2026-09-19): one versioned, DELTA-shaped record at the data-dir seam
 * (config.SETTINGS_FILE) holding every non-secret product preference.
 *
 * DELTA SEMANTICS (owner decision, 2026-09-19): the record stores EXPLICIT
 * user choices only — ABSENT keys resolve to the factory defaults compiled
 * into this module (FACTORY_SETTINGS). There are no model settings: the
 * outside agent (MCP) is the only model (owner, 2026-10-27). A
 * software update that ADDS a knob (new
 * tool, new role, new appearance field) therefore needs no migration: old
 * records simply lack the new keys. `version` is a PRIVATE schema counter
 * for BREAKING shape changes only (field renamed / meaning changed) —
 * unrelated to the app release version. Migrations live in the adapter
 * (src/store/settings.ts), not here.
 *
 * Sanitizer contract (mirrors render-settings.ts discipline): whatever
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


/** The schema version this code understands. Bump ONLY for breaking shape
 *  changes (a field renamed/meaning changed); pure additions never bump. */
export const CURRENT_SETTINGS_VERSION = 1;

/** The outside agent's provider id (MCP bridge, src/agent/agent-bridge.ts) —
 *  the ONLY model provider (owner, 2026-10-27: the built-in ChatGPT /
 *  Copilot / Grok sign-ins were removed). Every lesson and background job
 *  runs through the agent that connects over /api/mcp. Browser-safe home
 *  so the UI can recognise it. */
export const OUTSIDE_AGENT_PROVIDER = "agent";
/** The outside agent's one model id (the provider:id stamp on lessons and usage). */
export const OUTSIDE_AGENT_MODEL_ID = "outside-agent";
/** The context budget the app plans compaction around (and the lesson's
 *  context meter shows). Claude- and GPT-class agents both hold well over
 *  this; staying modest keeps lessons compact. */
export const OUTSIDE_AGENT_CONTEXT_WINDOW = 200_000;

/** General settings — app-level behavior. Version DISPLAY and plans login
 *  live outside the record (package.json / credential files) by owner decision. */
export interface GeneralSettings {
	/** Automatic startup/24h update checks (default ON). Manual checks bypass this. */
	autoUpdate?: boolean;
	/** The class the window shows (classes wave, 2026-10-26): a class id,
	 *  or "none" = No class (the default). */
	activeClass?: string;
	/** First-launch onboarding (owner, 2026-10-27): true = done or skipped
	 *  (existing users); false = in progress (shown until finished);
	 *  absent = not decided yet (src/server/onboarding.ts decides). */
	onboarded?: boolean;
	/** The newest version whose "What's new" the learner has been shown
	 *  ("0.4.1"). Absent = not recorded yet (src/server/whats-new.ts). */
	lastSeenVersion?: string;
}

/** Agent settings — everything about the non-conversation machinery. */
export interface AgentSettings {
	/** Tool toggles keyed by tool id (absent key = enabled). User-level
	 *  only — no per-chat override (owner decision 2026-09-19). */
	tools?: Record<string, boolean>;
	/** Prober graph tools (wave 7, owner ruling 2026-09-23): read-only
	 *  knowledge-graph views for the prober agent — a session list +
	 *  per-session propositions with understanding levels. Its SUBJECT
	 *  is the graph but its MECHANISM is agent capability (tool
	 *  registration), so it lives here in its OWN subsection, not in the
	 *  tool-toggles map. Absent = enabled (the toggle discipline); the
	 *  effective gate composes graph.enabled AND this switch. */
	graphTools?: { enabled?: boolean };
	/** System-prompt override SWITCHES keyed by segment path (absent key =
	 *  off). Switch-on requires the override file to exist (enforced by the
	 *  route); the switch is explicit so users keep a file on disk but run
	 *  the source default to compare (owner decision 2026-09-19). */
	prompts?: Record<string, boolean>;
}

/** Markdown-rendering knobs — the bare-bones set (owner decision). */
export interface MdRenderingSettings {
	/** Heading font weight (100–900, default 900). CSS resolves the nearest
	 *  available weight of the chosen font — no font introspection needed. */
	headingWeight?: number;
	/** Color for **bold** spans (default #ffffff). */
	boldColor?: string | null;
	/** Color for *italic* spans (default #ffffff). */
	italicColor?: string | null;
}

/** Appearance settings — mode, colors, type, markdown emphasis. */
export interface AppearanceSettings {
	/** "dark" | "light" (default dark). */
	mode?: "dark" | "light";
	/** The one user-chosen color; everything else derives per-mode in code.
	 *  null = the mode's default background. */
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

/** Knowledge-graph settings — a strict dependency ladder (owner decision
 *  2026-09-19): graph → embedding → clustering → labeling, each rung only
 *  meaningful when its parent is on (the UI grays dependents out; stored
 *  values persist but resolve inert). All default true. */
export interface GraphSettings {
	/** MASTER (and, since wave 7, ONLY): off = no extraction, no auditor.
	 *  The wave-7 collapse (owner ruling 2026-09-23) deleted the three
	 *  subordinate rungs — embedding/clustering/labeling — and the BYOK
	 *  embeddingModel: clustering is the free birth-session partition
	 *  derived on read (core/session-clusters.ts), labels ARE session
	 *  names, and the prober graph tools read the ledgers directly — there
	 *  is nothing left to configure. Data stays stored either way. */
	enabled?: boolean;
	/** The chunk budget (extraction-UX redesign, owner 2026-09-24): the
	 *  transcript-token share of the extractor's context — a run fires
	 *  when a chat's UNCOVERED tokens reach it, and the run batches the
	 *  oldest uncovered messages into runs of ≤ this many tokens. It
	 *  bounds both cost and chunk size (the extractor prompt also
	 *  carries the whole graph + instructions, so a smaller budget means
	 *  more, smaller runs — each paying that fixed overhead).
	 *
	 *  FACTORY DEFAULT 4096 (owner, 2026-10-13: halved back from the
	 *  digest-era 8192 — the labeled passages + message anchors made
	 *  smaller batches worth their overhead again; the pre-setting
	 *  constant was 4096, vision-extraction-coverage.md, 2026-09-15).
	 *  Only the FACTORY moves: an explicit user value always wins.
	 *
	 *  FLOOR 500 (EXTRACTION_CHUNK_TOKENS_FLOOR, the implementer's call
	 *  per the owner's dispatch): every run pays the graph-carrying
	 *  prompt overhead out of the write channel's money — a budget below
	 *  ~500 tokens would fire penny-batches that cost more per extracted
	 *  token than the content is worth, so the sanitizer clamps and the
	 *  PUT rejects below it. NO CEILING on purpose: a large budget just
	 *  delays extraction — the user's stated cost/thoroughness tradeoff,
	 *  not a misconfiguration to police. */
	extractionChunkTokens?: number;
}

/**
 * COMPACTION (owner round 14, 2026-10-05): the context-fitting mechanic's
 * user-facing knob. One number — the trigger threshold in context tokens.
 * The effective trigger is min(this, model contextWindow − 16k reserve)
 * (owner ruling: on big models the setting rules; on small ones the
 * window rules before the provider overflows).
 *
 * FACTORY DEFAULT 150_000 (owner ruling).
 *
 * FLOOR 32_000 (implementer's call, the chunk-budget discipline): below
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

/** Factory defaults for everything core can pin (owner decisions
 *  2026-09-19). Tools default on; prompts default off — hence their
 *  absence here. */
export interface FactorySettings {
	version: number;
	general: Required<Omit<GeneralSettings, "onboarded" | "lastSeenVersion">>;
	appearance: {
		mode: "dark" | "light";
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
	general: { autoUpdate: true, activeClass: "none" },
	appearance: {
		mode: "dark",
		background: null, // the dark default (#141414) lives in the mode's derivation curve
		fontFamily: null, // Source Sans 3
		proseFontSize: 16,
		sessionNameSerif: true,
		mdRendering: { headingWeight: 900, boldColor: null, italicColor: null },
	},
	graph: { enabled: true, extractionChunkTokens: 4096 },
	compaction: { thresholdTokens: 150_000 },
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
 *  anything else becomes null (the factory/per-mode default). */
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
	const prompts = sanitizeBooleanMap(raw.prompts);
	if (prompts) out.prompts = prompts;
	// Prober graph tools (wave 7): its own agent-section subsection —
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
	if (raw.mode === "dark" || raw.mode === "light") out.mode = raw.mode;
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
	// Wave 7 collapse (owner ruling 2026-09-23): the section is the master
	// switch ONLY. The dead rungs' keys (embedding/clustering/labeling/
	// embeddingModel) in existing records are simply UNREAD and DROPPED by
	// this reconstruction — the migration story: the next graph-section
	// write (PUT is replace-whole) persists the collapsed shape, and no
	// active code ever looks at the stale fields.
	//
	// extractionChunkTokens (extraction-UX redesign, 2026-09-24): the chunk
	// budget — clamp-never-reject (the bd68486 discipline): a finite
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
 *  reject-with-rationale (the graph chunk-budget precedent). */
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
		if (r.compaction !== undefined && r.compaction !== null && typeof r.compaction === "object") {
			out.compaction = sanitizeCompaction(r.compaction as Record<string, unknown>);
		}
	}
	// Unknown top-level keys ride along untouched (forward-compat). Known-
	// DEAD keys are stripped instead of riding: `chat` (the old default-
	// settings section) died with per-session models (owner, 2026-09-28),
	// and `models` (the strong/cheap/vision slots) died with the built-in
	// sign-ins (owner, 2026-10-27) — a fossil copy on disk must never
	// resurrect through reads (and any later write flushes it for good).
	for (const [key, value] of Object.entries(r)) {
		if (key === "chat" || key === "models") continue;
		if (!(key in out)) out[key] = value;
	}
	return out;
}
