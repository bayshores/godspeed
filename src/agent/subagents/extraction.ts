import * as crypto from "node:crypto";
import type { Usage } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import type { ModelRole } from "../../config.ts";
import { FACTORY_SETTINGS } from "../../core/settings.ts";
import type { PiEngine } from "../models.ts";
import type {
	CallUsage,
	ChatRecord,
	ExtractionRunUsage,
	ExtractionStageUsage,
	SessionFindings,
} from "../../core/contracts.ts";
import { getGraph, mergeFindings, type DerivedGraph, type EmissionStats, type GraphDeps } from "../../core/graph.ts";
import type { GraphStore } from "../../core/ports.ts";
import { emit } from "../../core/events.ts";
import { batchRuns, coverageOf, messageViewLines } from "../../core/coverage.ts";
import { failedOutputCallIds, type LhMessage } from "../../core/native-messages.ts";
import { runSubmitAgent, healStringifiedArrays } from "./submit-agent.ts";

/**
 * The extraction pipeline — the sole graph writer. Two stages:
 *
 *   extractor (LLM)  the ONE stage that sees the raw source (a session
 *                    rendered as the teacher's prose, each passage labeled
 *                    "TEACHER [id]", or a notes file walked in stretches).
 *                    Its prompt carries THE GRAPH SO FAR (what this source
 *                    already yielded) and RELATED IDEAS (the existing ideas
 *                    from other sources that best match the stretch, picked
 *                    by the app's local search, no model call). It submits
 *                    new ideas, reasoning chains, and the existing ideas it
 *                    re-teaches — one submit call, so a part costs one step.
 *                    Session propositions carry their passage's messageId.
 *   merger (core)    mergeFindings() → deterministic ledger appends +
 *                    chain simplification (core/graph.ts).
 *
 * Extract + merge run inside one process-wide graph lock: the extractor
 * reads the live graph, so two at once would each miss what the other is
 * adding and mint duplicates. Stretches of one source run in order.
 *
 * Created via createExtractionPipeline(deps) — the composition root injects
 * the storage ports, the engine and the related-ideas search; this module
 * never imports an adapter. runExtraction is single-flight per chat. On
 * failure nothing is checkpointed — the next trigger re-runs what's left.
 *
 * importNotes() runs the same stages over raw notes (any format). Source
 * ids ("src_" + path hash) play the chatId role, and the source record
 * carries the file path + the run's usage.
 *
 * Every stage logs its start, its steps and its duration.
 */

// ─── the source view (what the extractor sees) ──────────────────────────────

/**
 * The extraction view: the session as teacher prose only, each passage
 * labeled with its message id. The markdown engine
 * (core/session-markdown.ts) serves the markdown export and read_lesson;
 * the extractor does not use it.
 */

/** The whole-record view (used by callers that render a full session;
 *  the pipeline itself batches). TEACHER PROSE ONLY (owner, 2026-09-28),
 *  passages labeled with their message ids (2026-10-13).
 */
export function transcriptView(record: ChatRecord): string {
	return proseView(record.messages, record.title);
}

/** The extraction view under the teacher-prose ruling (owner, 2026-09-28):
 *  ONLY learner-facing teacher prose (text or send_to_user) — no learner
 *  messages, thinking, other tool calls/results, or quiz blocks — labeled with
 *  its ACTUAL message id (owner, 2026-10-13): the view lines ARE
 *  core/coverage.ts messageViewLines ("TEACHER [id] text"), the exact
 *  lines the coverage fingerprints hash, so the extractor can anchor
 *  every proposition to the passage it came from (the session submit's
 *  required messageId). */
function proseView(
	messages: ReadonlyArray<LhMessage>,
	title?: string,
	failedOutputCalls: ReadonlySet<string> = failedOutputCallIds(messages),
): string {
	const lines = messages.flatMap((message) => messageViewLines(message, message.id, failedOutputCalls));
	const head = title && title.length > 0 ? `# ${title}\n\n` : "";
	return head + lines.join("\n\n");
}

// ─── the extractor ──────────────────────────────────────────────────────────

const propositionProps = {
	id: Type.String({ description: 'Local id: "p1", "p2", … — referenced by chains in this call.' }),
	name: Type.String({
		description:
			"A very short label — established terminology, the term the discipline itself uses, a glossary " +
			"headword a textbook would print ('Will to power', 'Divine command theory'). Not a sentence, " +
			"needn't be unique or self-contained: this becomes the node's global label in the graph.",
	}),
	statement: Type.String({
		description:
			"One true, self-contained, world-facing core idea at full precision. Never about the " +
			'learner, the teacher, or the reading: not "the learner understands X" but "X". A misconception ' +
			"enters as its TRUE correction.",
	}),
	aliases: Type.Optional(
		Type.Array(Type.String(), {
			description: "Verbatim phrasings the source used for the same proposition, if any.",
		}),
	),
};

// The extractor redesign (owner, 2026-09-30): the extractor submits
// REASONING CHAINS — premises + conclusion — stored AS-IS (chains-primary,
// same evening: chains.jsonl is the truth; edges are a derived view, and
// supports edges are retired entirely).
const endpoint = (role: string) =>
	Type.String({
		description:
			`The id this ${role} — EITHER an existing idea id from THE GRAPH SO FAR or RELATED IDEAS in the prompt, ` +
			'verbatim ("n_…"), OR the local id of a proposition in this submission ("p1", …).',
	});

const chainSchema = Type.Object({
	premises: Type.Array(endpoint("premise uses"), {
		minItems: 1,
		description:
			"Premise ids used TOGETHER: they jointly entail the conclusion; independent reasons are separate chains.",
	}),
	conclusion: endpoint("conclusion is"),
});

// Weak-model tolerance (owner, 2026-09-25): the old zod `.default([])` /
// `.default({ quiz: {} })` on required-but-empty fields becomes Type.Optional
// here + a ??-fill at the submit seam (fillFindings below) — same
// contract on the wire (omission tolerated, empty never means "invalid"),
// no zod left in the agent band.
const propositionsDescription =
	"Only the NEW core ideas this stretch contributes — ideas the prompt's THE GRAPH SO FAR or RELATED " +
	"IDEAS already hold are referenced by id (in chains and reteaches), never restated here.";
const reteachesSchema = Type.Array(Type.String(), {
	description:
		'Ids ("n_…") of ideas already in THE GRAPH SO FAR or RELATED IDEAS that this stretch also teaches; ' +
		"pass [] when none — never omit the field.",
});
const chainsDescription =
	"Every argument this stretch makes — including arguments that join new ideas to established " +
	"ones; conclusions reusable by id as premises of later chains; bare ideas (no argument) ride " +
	"the propositions list alone; pass [] when none — never omit the field.";

const findingsSchema = Type.Object({
	propositions: Type.Array(Type.Object(propositionProps), {
		description: propositionsDescription,
	}),
	chains: Type.Array(chainSchema, {
		description: chainsDescription,
	}),
	reteaches: reteachesSchema,
});

// THE SESSION EXTENSION (owner, 2026-10-13): every session proposition
// carries a REQUIRED messageId — the anchor of the passage it came from,
// copied from the view's "TEACHER [id]" label (validated at the submit
// seam against the CURRENT batch). The NOTES door has no messages: its
// schema stays the base shape above, prompt and wire unchanged.
const sessionPropositionProps = {
	...propositionProps,
	messageId: Type.String({
		description:
			"The message id of the ONE passage in this stretch that most directly states or explains this " +
			'proposition — copy it EXACTLY from that passage\'s "TEACHER [id]" label.',
	}),
};

const sessionFindingsSchema = Type.Object({
	propositions: Type.Array(Type.Object(sessionPropositionProps), {
		description: propositionsDescription,
	}),
	chains: Type.Array(chainSchema, {
		description: chainsDescription,
	}),
	reteaches: reteachesSchema,
});

/** What the extractor SUBMITS (the redesign's wire shape) — propositions
 *  + chains. fillFindings normalizes it; validateFindingsChains checks
 *  the chain laws; asSessionFindings lifts it straight into
 *  SessionFindings — chains are stored AS-IS (chains-primary, owner
 *  2026-09-30: no edge translation at any seam). */
type FindingsSubmit = Static<typeof findingsSchema>;

/** The SESSION wire — the notes shape plus the REQUIRED messageId anchor
 *  on every proposition (owner, 2026-10-13). */
type SessionFindingsSubmit = Static<typeof sessionFindingsSchema>;

// The notes front door's wire shape is the session shape MINUS the
// messageId anchor (owner, 2026-10-13: only the SESSION door demands
// passage anchors — notes have no messages, so their prompt and schema
// stay exactly as they were): one base findings type for both doors,
// the anchor riding as an optional field.
type NotesFindings = SessionFindings;

// ── the submit seam (owner, 2026-09-28; redesigned 2026-09-30) ──
//
// Every top-level field on each submit tool is REQUIRED — a payload
// missing `chains` or `reteaches` fails validation
// instead of silently merging structure-less (the degraded-retry hole:
// the model's first truncated attempt failed validation, then the retry
// passed with propositions only — optional fields ??-filled [] — merging
// a pile of nodes with no structure). Only the per-item aliases stay
// optional with a ??-fill.

function fillFindings<T extends { propositions: Array<{ aliases?: string[] }>; chains: unknown }>(
	raw: T,
): T {
	return {
		...raw,
		propositions: raw.propositions.map((p) => ({ ...p, aliases: p.aliases ?? [] })),
	};
}

/** The notes fill: the shared alias ??-fill PLUS the door's boundary — a
 *  stray messageId (the notes schema has none; extra properties pass
 *  schema validation) is stripped so notes provenance stays chat-level
 *  (the file is the anchor, owner 2026-09-13). */
function fillNotesFindings(raw: FindingsSubmit): FindingsSubmit {
	return fillFindings({
		...raw,
		propositions: raw.propositions.map((p) => {
			const stripped = { ...p } as typeof p & { messageId?: unknown };
			delete stripped.messageId;
			return stripped;
		}),
	});
}

/** The chain laws (extractor redesign, 2026-09-30; digest-aware
 *  2026-09-30 evening) — the LOUD channel: runSubmitAgent turns a
 *  problem string into an error tool result and the model re-submits
 *  within its turns. The MIXED NAMESPACE: an
 *  endpoint resolves when it is a submitted proposition id OR an
 *  existing graph node id (the extractor continues a partly-extracted
 *  source and references digest ids verbatim). Identical (premise-set,
 *  conclusion) chains are NOT errors — they dedupe silently at the
 *  merge (chainKey): restating an argument is a no-op. */
function validateFindingsChains(value: FindingsSubmit, existingIds: ReadonlySet<string>): string | null {
	const unknownRetaught = value.reteaches.find((id) => !existingIds.has(id));
	if (unknownRetaught !== undefined) {
		return `reteaches: "${unknownRetaught}" is not an existing idea id from THE GRAPH SO FAR or RELATED IDEAS — list only ids shown there.`;
	}
	const ids = new Set(value.propositions.map((p) => p.id));
	for (const chain of value.chains) {
		if (chain.premises.length === 0) {
			return "chains: premises must name at least one proposition — a proposition with no argument stays in the propositions list alone.";
		}
		const unknown = [...chain.premises, chain.conclusion].find((id) => !ids.has(id) && !existingIds.has(id));
		if (unknown !== undefined) {
			return `chains: "${unknown}" is neither a submitted proposition id nor an existing idea id from THE GRAPH SO FAR or RELATED IDEAS — every premise and conclusion must resolve.`;
		}
		if (chain.premises.includes(chain.conclusion)) {
			return "chains: a conclusion cannot be its own premise.";
		}
	}
	return null;
}

/** The SESSION anchor law (owner, 2026-10-13): every proposition names a
 *  passage of the CURRENT batch — nonempty, and a teacher-prose message
 *  id present in the stretch this extractor is reading (the same ids the
 *  view's TEACHER [id] labels carry). Refused anchors ride the existing
 *  error-back channel: no merge, no coverage checkpoint, until a valid
 *  submit lands. The boundary is strict on purpose — an id from a LATER
 *  or already-covered batch, another chat, or a learner/tool message is
 *  refused even when it is a real message id of this chat. */
function validateSessionAnchors(value: SessionFindingsSubmit, batchIds: ReadonlySet<string>): string | null {
	for (const p of value.propositions) {
		if (p.messageId.trim().length === 0) {
			return `propositions: "${p.id}" is missing its messageId — copy the message id from the brackets of the passage (TEACHER [id]) that most directly states or explains it.`;
		}
		if (!batchIds.has(p.messageId)) {
			return `propositions: "${p.id}" names messageId "${p.messageId}", which is not a passage of THIS stretch — copy the id from the brackets of one of this stretch's own TEACHER [id] passages.`;
		}
	}
	return null;
}

/** (chains-primary, owner 2026-09-30) the wire IS the pipeline shape
 *  now: propositions + chains, no translation — the stores keep the
 *  chains and the derived edge view is recomputed on read. The fill
 *  already ran inside runSubmitAgent; this only re-asserts the
 *  aliases-filled type (and preserves the session submit's messageId
 *  anchor, 2026-10-13 — both doors lift through here). */
const asSessionFindings = (
	raw: {
		propositions: Array<{ id: string; name: string; statement: string; aliases?: string[]; messageId?: string }>;
		chains: Array<{ premises: string[]; conclusion: string }>;
		reteaches: string[];
	},
): SessionFindings => ({
	propositions: raw.propositions.map((p) => ({ ...p, aliases: p.aliases ?? [] })),
	chains: raw.chains,
	reteaches: raw.reteaches,
});

// ── the extractor's system prompt (owner redesign, 2026-09-30) ──
//
// GOAL-FIRST, NO RULE ARMOR: the old doctrine's defensive lists (DROP
// lists, merge-your-own-output, name walls, when-in-doubt-omit, the
// faithfulness paragraph) are ALL CUT — the prompt states the goal and
// the submission mechanics; the tool's field descriptions carry the
// details. One shared core + two contextualizations, assembled here —
// session and notes share the core by construction. (The old opening
// describing Quiz/Recall-check/Question blocks was stale since the
// 2026-09-28 teacher-prose ruling and is simply omitted.)

/** The session-only anchor instruction (owner, 2026-10-13, verbatim):
 *  passages arrive labeled "TEACHER [id]" and every proposition must
 *  name the ONE passage it came from — the anchor the merger stamps
 *  into message-granular provenance. Notes have no passages: their
 *  contextualization stays untouched. */
export const SESSION_MESSAGE_ID_RULE =
	"For each new proposition, copy the message ID of the passage that most directly states or explains it into messageId.";

export const SESSION_PREAMBLE =
	"You are the extraction stage of a learning application. You read one stretch of a source — a teaching " +
	"session, rendered as the teacher's prose in reading order — and report what it teaches as findings " +
	"for the learner's global knowledge graph, building on everything already extracted from this source.";

export const NOTES_PREAMBLE =
	"You are the extraction stage of a learning application. You read one stretch of a source — the " +
	"author's personal notes, rendered in reading order — and report what it teaches as findings for the " +
	"learner's global knowledge graph, building on everything already extracted from this source.";

export const EXTRACTION_CORE = `THE GOAL: uncover the source's CORE IDEAS and show how everything derives from the foundations. The
source teaches by arguing — ideas worked out from other ideas, down to a foundation the rest stands on.
Your deliverable is twofold: the core ideas themselves, and the chains of reasoning that derive them.
Each chain is premises that JOINTLY entail a conclusion. Entailment is the only link that earns a
chain — where the real connection is historical or narrative (who argued what, how a debate or
exposition unfolds), there is no chain; keep the pieces as bare ideas or drop them. The direction of
the graph is upward: foundational ideas at the bottom, derived ideas above them, each chain showing
how its conclusion follows from what is more established — do not submit connections that carry no
derivation.

The graph holds TRUE ideas about the world, nothing else — never anything about the learner, the
teacher, or this reading: not "the learner understands X" but X. A misconception enters as its TRUE
correction. Each statement is one self-contained idea at full precision.

Extract the load-bearing ideas of the subject — what a reference on it would teach — not the full run
of the discourse. An idea earns its place only when the source's arguments run through it — examples,
notation glosses, and restatements that no argument needs are not core ideas. Every idea must stand
alone for a reader who never saw this source: names and statements may not lean on the source's own
scaffolding (claim numbering, axiom tags, arc labels); a claim that only matters as part of how this
document is organized is not knowledge — drop it.

When the prompt carries THE GRAPH SO FAR, you are continuing a source already partly extracted; when
it carries RELATED IDEAS, other sources already taught those ideas. Build on both. An idea either list
already holds — even worded differently — is never submitted again: reference it by its id ("n_…"),
and list its id in reteaches when this stretch teaches it. Prefer chains that lean on established
conclusions as premises — derive new material from what is already derived. Do not re-derive a
conclusion the graph already holds unless the route is genuinely different.

SUBMIT with one submit_findings call: every NEW core idea with a short name and a precise statement,
every chain as premises + conclusion, and in reteaches the ids of existing ideas this stretch also
teaches. A chain's premises and conclusion may be ids from this submission OR existing ids from THE
GRAPH SO FAR or RELATED IDEAS, verbatim. Premises within one chain are used TOGETHER — independent
arguments for the same conclusion are separate chains. A conclusion may reappear, by id, as a premise
of later chains. A bare idea that no argument uses rides the propositions list alone. Include every
field even when empty — "chains": [] when the source makes no arguments, "reteaches": [] when it
re-teaches nothing. The tool's field descriptions carry the details.`;

export const EXTRACTOR_INSTRUCTIONS = `${SESSION_PREAMBLE}\n\n${EXTRACTION_CORE}\n\n${SESSION_MESSAGE_ID_RULE}`;
export const NOTES_EXTRACTOR_INSTRUCTIONS = `${NOTES_PREAMBLE}\n\n${EXTRACTION_CORE}`;

// ── the prompt's graph context ──
//
// THE GRAPH SO FAR: everything this source already yielded (its ideas +
// chains). RELATED IDEAS: existing ideas from OTHER sources that best match
// the stretch (picked by the app's search). Ids ride verbatim — that is
// what the extractor references. "" when there is nothing to show.
export function graphContext(graph: DerivedGraph, sourceId: string, relatedIds: readonly string[]): string {
	const nameOf = new Map(graph.nodes.map((n) => [n.id, n.name]));
	const line = (n: DerivedGraph["nodes"][number]) => `  ${n.id} | ${n.name} | ${n.statement.replace(/\s+/g, " ")}`;
	const isOurs = (n: DerivedGraph["nodes"][number]) => n.provenance.some((pt) => pt.chatId === sourceId);
	const ours = graph.nodes.filter(isOurs);
	const ourChains = graph.chains.filter((c) => c.provenance.some((pt) => pt.chatId === sourceId));
	const byId = new Map(graph.nodes.map((n) => [n.id, n]));
	const related = relatedIds.map((id) => byId.get(id)).filter((n): n is DerivedGraph["nodes"][number] => n !== undefined && !isOurs(n));
	const lines: string[] = [];
	if (ours.length > 0 || ourChains.length > 0) {
		lines.push("THE GRAPH SO FAR — everything already extracted from this source (reference these ids verbatim):");
		for (const n of ours) lines.push(line(n));
		if (ourChains.length > 0) {
			lines.push("DERIVATIONS ALREADY RECORDED (build on these; do not re-derive them):");
			for (const c of ourChains) {
				const names = c.premises.map((p) => nameOf.get(p) ?? p).join(" ∧ ");
				lines.push(`  [${c.premises.join(" + ")} ⇒ ${c.conclusion}]  ${names} ⇒ ${nameOf.get(c.conclusion) ?? c.conclusion}`);
			}
		}
	}
	if (related.length > 0) {
		lines.push("RELATED IDEAS — already in the graph from other sources (reference these ids verbatim):");
		for (const n of related) lines.push(line(n));
	}
	return lines.join("\n");
}

/** The extractor over ONE session transcript (the chat front door).
 *  `batchIds` — the CURRENT batch's teacher-prose message ids — is the
 *  anchor boundary: every submitted proposition's messageId must name
 *  one of them (validateSessionAnchors at the submit seam). */
function runExtractor(
	engine: PiEngine | undefined,
	taskLabel: string,
	prompt: string,
	existingIds: ReadonlySet<string>,
	batchIds: ReadonlySet<string>,
	signal: AbortSignal | undefined,
	onStep: (usage: Usage, model: string, step: number, finishReason: string, tools: string) => void,
): Promise<SessionFindings> {
	// Chains in (the wire), chains out (the store) — no translation seam
	// since chains-primary. Validation runs at the submit seam (error-back)
	// over the MIXED namespace: local ids + existing graph ids, plus the
	// session anchor law (messageId ∈ the current batch, 2026-10-13).
	return runSubmitAgent<SessionFindingsSubmit>({
		taskLabel,
		toolName: "submit_findings",
		toolDescription: "Submit the session findings.",
		parameters: sessionFindingsSchema,
		fill: fillFindings,
		validate: (value) => validateSessionAnchors(value, batchIds) ?? validateFindingsChains(value, existingIds),
		systemPrompt: EXTRACTOR_INSTRUCTIONS,
		prompt,
		engine,
		signal,
		onStep,
		neverSubmitted: "the extractor never submitted findings",
		prepareArguments: healStringifiedArrays,
	}).then(asSessionFindings);
}

/** The extractor over ONE source of raw personal notes (the format-agnostic
 *  front door): same single-submit shape, notes-mode prompt + schema —
 *  the BASE wire (no messageId: notes have no passages, and a stray one
 *  is stripped at the fill seam). */
function runNotesExtractor(
	engine: PiEngine | undefined,
	taskLabel: string,
	prompt: string,
	existingIds: ReadonlySet<string>,
	signal: AbortSignal | undefined,
	onStep: (usage: Usage, model: string, step: number, finishReason: string, tools: string) => void,
): Promise<NotesFindings> {
	return runSubmitAgent<FindingsSubmit>({
		taskLabel,
		toolName: "submit_findings",
		toolDescription: "Submit the notes findings.",
		parameters: findingsSchema,
		fill: fillNotesFindings,
		validate: (value) => validateFindingsChains(value, existingIds),
		systemPrompt: NOTES_EXTRACTOR_INSTRUCTIONS,
		prompt,
		engine,
		signal,
		onStep,
		neverSubmitted: "the extractor never submitted findings",
		prepareArguments: healStringifiedArrays,
	}).then(asSessionFindings);
}

// ─── the pipeline status registry ─────────────────────────────────────────────

/** The pipeline phases, in order — what the activity dock shows.
 *  "waiting": queued behind another job's extract + merge (the graph lock).
 *  "grouping": a topic-grouping run (startBackgroundGraphRun). */
export type ExtractionPhase = "waiting" | "extracting" | "merging" | "grouping";

/** One in-flight pipeline run. Module-level: one process, one registry.
 *  Exported for the status payload's consumer typing (the dock). */
export interface RunningExtraction {
	/** The SOURCE id (chat id / notes src id) — the payload's identity and
	 *  the abort key. The registry KEY adds "#i" for chunk jobs (a
	 *  multi-chunk source owns several entries); this field stays the
	 *  source id so the feed's reveal logic and abort stay source-scoped. */
	chatId: string;
	/** PER-CHUNK JOBS (owner, 2026-09-28): which chunk of how many this
	 *  job is — present only when the source fanned out (n > 1). Drives
	 *  the feed row's "· i/N" suffix. */
	part?: { i: number; n: number };
	/** Which front door the run came through — label + usage-persistence
	 *  depend on it (chats bill their chat record; notes bill the source
	 *  record). */
	kind: "chat" | "notes" | "topics";
	/** Display label (the file path for notes imports); the activity feed
	 *  falls back to the chat store for chat runs. */
	label?: string;
	phase: ExtractionPhase;
	startedAt: number;
	/** Live per-stage usage, accumulated as steps bill (the activity dock
	 *  reads it through /api/activity). */
	usage: {
		extractor?: ExtractionStageUsage;
	};
	/** True-cancellation handle (the dock's abort button): one controller per
	 *  run, shared across phases; abort() cancels the in-flight model call. */
	controller: AbortController;
}

interface LhExtractionGlobal {
	__lhExtractionRuns?: {
		/** In-flight pipeline runs, keyed chatId (chat) / src id (notes). */
		running: Map<string, RunningExtraction>;
		/** The single-flight guard, shared by every pipeline instance. */
		inFlight: Set<string>;
		/** Last minted startedAt — kept monotonic so two runs starting in the
		 *  same millisecond never collide on the usage idempotency key. */
		lastStartedAt: number;
	};
	/** The graph lock: a FIFO promise chain — extract + merge run one job
	 *  at a time, process-wide. globalThis for the same module-instance
	 *  reason as the run registries. */
	__lhGraphLock?: { tail: Promise<void> };
}

/** THE RUN REGISTRIES live on globalThis, not module level — the
 *  turn-liveness lesson: Next dev compiles each route entry as its own
 *  module instance, so a module-level Map is a different object in the
 *  /api/activity route than in the pipeline's chat-handler instance —
 *  the status routes would read an always-empty registry. One process,
 *  one truth — the same idiom as the turn, wake, and abort registries
 *  (moved 2026-09-19, the observability-accuracy wave; also makes the
 *  single-flight guard cross route instances). */
function runs(): NonNullable<LhExtractionGlobal["__lhExtractionRuns"]> {
	const g = globalThis as typeof globalThis & LhExtractionGlobal;
	return (g.__lhExtractionRuns ??= { running: new Map(), inFlight: new Set(), lastStartedAt: 0 });
}

/** In-flight pipeline runs (oldest first), shown in /api/activity. */
export function extractionStatuses(): RunningExtraction[] {
	return [...runs().running.values()].sort((a, b) => a.startedAt - b.startedAt);
}

/** A non-extraction background graph job (the topic grouper, redesign
 *  2026-10-27) joins the same registry so the activity dock shows it and
 *  its abort button works (abortExtraction by `key`). One entry per key;
 *  a second start while one is registered returns the running controller.
 *  Call finishBackgroundGraphRun on every exit. */
export function startBackgroundGraphRun(key: string, label: string, phase: ExtractionPhase = "grouping"): AbortController {
	const R = runs();
	const prev = R.running.get(key);
	if (prev) return prev.controller;
	R.lastStartedAt = Math.max(Date.now(), R.lastStartedAt + 1);
	const controller = new AbortController();
	R.running.set(key, { chatId: key, kind: "topics", label, phase, startedAt: R.lastStartedAt, usage: {}, controller });
	emit("activity-changed", {});
	return controller;
}

export function finishBackgroundGraphRun(key: string): void {
	if (runs().running.delete(key)) emit("activity-changed", {});
}

/** True cancellation of the in-flight run for a chat (the dock's abort
 *  button): the pending model call receives the signal — the provider
 *  cancels the request, spend stops — and the run ends like a failure:
 *  nothing merged, nothing checkpointed, partial usage still persisted.
 *  Returns false when no run is in flight (idempotent no-op). */
export function abortExtraction(chatId: string): boolean {
	// PER-CHUNK JOBS (owner, 2026-09-28): a source may own several registry
	// entries (one per chunk/batch) — aborting the source aborts EVERY
	// job of its fan-out.
	let found = false;
	for (const run of runs().running.values()) {
		if (run.chatId !== chatId) continue;
		run.controller.abort();
		found = true;
	}
	return found;
}
// ─── the pipeline ───────────────────────────────────────────────────────────

interface ExtractionModels {
	/** Test seam: a scripted engine per stage — checked FIRST, ahead of the
	 *  engineFor chain (production wires no direct values). */
	extractor?: PiEngine;
	/** The engine per role — production always passes the outside agent
	 *  (owner, 2026-10-27). With no engine at all the front doors refuse
	 *  with NoEngineError before any stage runs. */
	engineFor?: (role: ModelRole) => PiEngine | undefined;
}

/** The pipeline has nothing to run its stages on (only reachable when no
 *  engineFor is wired — tests and misconfigured callers). */
export class NoEngineError extends Error {
	constructor() {
		super("No model is available for extraction");
		this.name = "NoEngineError";
	}
}

interface ExtractionPipelineDeps extends GraphDeps, ExtractionModels {
	/** The chunk budget — the transcript-token share of the extractor's
	 *  context; batches fill to it (the trigger fires on the same number,
	 *  read fresh per turn by the composition root). OPTIONAL with the
	 *  factory default (4096) so test fixtures stay minimal; the server
	 *  callers wire the live effective settings (extraction-UX redesign,
	 *  2026-09-24). */
	getChunkTokens?: () => number;
	/** The graph a LESSON writes to (classes wave, 2026-10-26: its class's
	 *  own graph, or "No class"). Absent = deps.graphStore for every chat
	 *  (test fixtures, single-graph callers). */
	graphStoreForChat?: (chatId: string) => GraphStore;
	/** Called after a run that may have written a graph ends (done, partial
	 *  or failed — the callee decides whether anything changed). The topic
	 *  grouper's trigger (redesign 2026-10-27). Errors are logged, never
	 *  thrown into the run. */
	onGraphWritten?: (graphStore: GraphStore) => void;
	/** The existing ideas most related to a stretch, by the app's local
	 *  search (node ids, best first). Absent = no related ideas (tests). */
	relatedFacts?: (graphStore: GraphStore, text: string, limit: number) => Promise<string[]>;
}

/** How many related ideas each stretch's prompt carries. */
const RELATED_FACTS = 25;

export interface NotesImportInput {
	/** The source's file path — its identity (deterministic src id) AND its
	 *  provenance label in the detail card. */
	filePath: string;
	/** The file's raw content, VERBATIM — any format. */
	text: string;
	/** The graph to import into (classes wave: a class's own graph).
	 *  Absent = deps.graphStore ("No class"). */
	graphStore?: GraphStore;
	/** An explicit source id (class files: src_ + hash of class + file id,
	 *  so the same filename in two classes never collides). Absent = the
	 *  path-hash id, as before. */
	sourceId?: string;
}

/** A notes import did not finish. Earlier graph writes and billed usage are
 * retained; partialStats describe known merges, not an all-or-nothing result. */
export class NotesImportError extends Error {
	constructor(
		public readonly outcome: "failed" | "partial" | "aborted" | "busy",
		public readonly partialStats: EmissionStats,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "NotesImportError";
	}
}

export interface ExtractionPipeline {
	/** Extract + merge ONE chat. Single-flight per chat; resolves to
	 *  the merger's append stats (or throws — no checkpoint on failure). */
	runExtraction(chatId: string): Promise<EmissionStats>;
	/** The format-agnostic front door (2026-09-13): run the same pipeline
	 *  over ONE raw notes file. The source id is deterministic per file
	 *  path, so re-importing the same file re-runs extraction against the
	 *  same source identity (mappings dedupe by it). */
	importNotes(input: NotesImportInput): Promise<EmissionStats>;
}

/** pi's per-step usage, flattened to the persisted CallUsage fields
 *  (the money channel's capture shape, contracts/chat.ts). Exported for
 *  the cluster namer — the same capture shape (2026-09 graph cost
 *  metrics wave). Module scope: no closure deps, pure projection. */
function callUsage(usage: Usage): CallUsage {
	return {
		inputTokens: usage.input,
		outputTokens: usage.output,
		cacheReadTokens: usage.cacheRead,
		cacheWriteTokens: usage.cacheWrite,
		cacheWrite1hTokens: usage.cacheWrite1h ?? 0,
		// Optional in pi's Usage (providers that never emit reasoning
		// tokens leave it unset) — persisted as 0, never dropped.
		reasoningTokens: usage.reasoning ?? 0,
	};
}

export function createExtractionPipeline(deps: ExtractionPipelineDeps): ExtractionPipeline {
	const { chatStore, graphStore } = deps;
	// Stage-engine resolution: a direct test value wins; otherwise the
	// injected engineFor — the job runner's exact treatment. undefined =
	// nothing to run on; the front-door guards turn that into a refusal.
	const stageEngine = (role: ModelRole, override?: PiEngine): PiEngine | undefined =>
		override ?? deps.engineFor?.(role);
	/** The refusal guard: every stage needs an engine — refuse BEFORE any
	 *  batch runs. */
	function refuseIfStagesUnready(): void {
		if (!stageEngine("extractor", deps.extractor)) {
			console.info("[extraction] refused — no engine");
			throw new NoEngineError();
		}
	}
	// THE SHARED REGISTRIES (runs() above — globalThis): every pipeline
	// instance (route entries in dev, tests) sees the same runs, the same
	// single-flight guard. No module-level state left in this factory.
	const runningExtractions = runs().running;
	const inFlight = runs().inFlight;

	/** WHICH GRAPH a source writes to (classes wave, 2026-10-26 — owner
	 *  ruling: writes never cross classes). A notes import registers its
	 *  target for the run's lifetime; a chat resolves through its class. */
	const sourceStores = new Map<string, GraphStore>();
	function storeFor(sourceId: string): GraphStore {
		const registered = sourceStores.get(sourceId);
		if (registered) return registered;
		if (sourceId.startsWith("src_")) return graphStore;
		return deps.graphStoreForChat?.(sourceId) ?? graphStore;
	}

	function setPhase(
		jobKey: string,
		phase: ExtractionPhase,
		kind: "chat" | "notes",
		label?: string,
		part?: { i: number; n: number },
	): void {
		const R = runs();
		const prev = runningExtractions.get(jobKey);
		if (!prev) R.lastStartedAt = Math.max(Date.now(), R.lastStartedAt + 1);
		runningExtractions.set(jobKey, {
			chatId: prev?.chatId ?? jobKey.split("#")[0]!,
			part: prev?.part ?? part, // phase changes never lose the part
			kind,
			label: prev?.label ?? label, // phase changes never lose the label
			phase,
			startedAt: prev?.startedAt ?? R.lastStartedAt,
			usage: prev?.usage ?? {}, // phase changes never lose usage
			controller: prev?.controller ?? new AbortController(),
		});
		// Every phase transition announces the dock (push S5, 2026-10-02):
		// notify-after-write — the registry is the feed's truth.
		emit("activity-changed", {});
	}

	/** Run over (done, failed, aborted — every exit is a finally): the row
	 *  leaves the feed. ONE seam for all delete sites so no exit path can
	 *  miss the announce (push S5, 2026-10-02). */
	function finishExtraction(jobKey: string): void {
		runningExtractions.delete(jobKey);
		emit("activity-changed", {});
	}

	/** Accumulate one billed step into the run's registry entry (live). */
	function recordStep(jobKey: string, usage: CallUsage, model: string): void {
		const run = runningExtractions.get(jobKey);
		if (!run) return; // not running (tests driving stages directly)
		run.usage.extractor ??= { model, steps: [] };
		run.usage.extractor.steps.push(usage);
	}

	/** THE GRAPH LOCK: extract + merge run one job at a time, process-wide,
	 *  so each extractor sees every earlier merge (no duplicate mints). FIFO,
	 *  reacquired per batch, abort-aware on both sides of the queue (a
	 *  waiter that aborts leaves without running; its link resolves once the
	 *  job ahead of it is done, so successors keep waiting their turn and
	 *  never hang). */
	async function withGraphLock<T>(jobKey: string, kind: "chat" | "notes", label: string | undefined, part: { i: number; n: number } | undefined, critical: () => Promise<T>): Promise<T> {
		setPhase(jobKey, "waiting", kind, label, part);
		const g = globalThis as typeof globalThis & LhExtractionGlobal;
		const lock = (g.__lhGraphLock ??= { tail: Promise.resolve() });
		const prev = lock.tail;
		let release!: () => void;
		lock.tail = new Promise<void>((resolve) => (release = resolve));
		const signal = runningExtractions.get(jobKey)?.controller.signal;
		let onAbort: (() => void) | undefined;
		const aborted = new Promise<never>((_, reject) => {
			if (!signal) return;
			onAbort = () => {
				const err = new Error("extraction aborted while waiting for the graph lock");
				err.name = "AbortError";
				reject(err);
			};
			if (signal.aborted) onAbort();
			else signal.addEventListener("abort", onAbort, { once: true });
		});
		try {
			await Promise.race([prev, aborted]);
			signal?.throwIfAborted(); // aborted exactly at handoff
			return await critical();
		} finally {
			if (onAbort && signal && !signal.aborted) signal.removeEventListener("abort", onAbort);
			// After prev: an aborted waiter must not hand the lock on while
			// the job ahead of it still holds it (prev never rejects).
			void prev.then(release);
		}
	}

	/** The prompt's graph context for one stretch: this source's findings
	 *  so far + the related ideas the search picks for the stretch text. */
	async function promptContext(sourceId: string, stretch: string): Promise<{ graph: DerivedGraph; context: string }> {
		const store = storeFor(sourceId);
		const graph = getGraph(store);
		const related = deps.relatedFacts ? await deps.relatedFacts(store, stretch, RELATED_FACTS) : [];
		return { graph, context: graphContext(graph, sourceId, related) };
	}

	/** The job's name on the outside agent's work items: which lesson or
	 *  file, and which part when the source was split. */
	function extractionTaskLabel(jobKey: string): string {
		const run = runningExtractions.get(jobKey);
		const name = run?.label ?? chatStore.getChat(run?.chatId ?? jobKey)?.title ?? jobKey;
		const part = run?.part ? ` (part ${run.part.i} of ${run.part.n})` : "";
		return `Graph extraction · ${name}${part}`;
	}

	async function extract(
		jobKey: string,
		sourceId: string,
		view: string,
		batchIds: ReadonlySet<string>,
	): Promise<SessionFindings> {
		const signal = runningExtractions.get(jobKey)?.controller.signal;
		signal?.throwIfAborted(); // an abort during a sync gap ends the job here
		const { graph, context } = await promptContext(sourceId, view);
		const prompt = context === "" ? view : `${context}\n\n${view}`;
		console.info(
			`[extraction ${jobKey}] extractor starting (${view.split("\n").length} markdown lines` +
				`${context === "" ? "" : `, context ${context.split("\n").length} lines`})`,
		);
		const t0 = performance.now();

		const findings = await runExtractor(
			stageEngine("extractor", deps.extractor),
			extractionTaskLabel(jobKey),
			prompt,
			new Set(graph.nodes.map((n) => n.id)),
			batchIds,
			signal,
			(usage, model, step, finishReason, tools) => {
				recordStep(jobKey, callUsage(usage), model);
				console.info(`[extraction] extractor step ${step}: ${finishReason}, tools: ${tools}`);
			},
		);
		console.info(`[extraction ${jobKey}] extractor done in ${Math.round(performance.now() - t0)}ms`);
		return findings;
	}

	/** Append the run's usage record to the chat's extractions log — success
	 *  or failure: a failed run still spent money, and its partial usage is
	 *  exactly what the record should show (stats absent = never merged).
	 *  Idempotent per startedAt (the store dedupes). */
	function persistRunUsage(jobKey: string, durationMs: number, stats: EmissionStats | undefined): void {
		const run = runningExtractions.get(jobKey);
		if (!run) return; // not running (tests driving stages directly)
		// PER-CHUNK JOBS (owner, 2026-09-28): the registry KEY may carry a
		// "#i" suffix — the usage LEDGERS key by SOURCE (run.chatId): one
		// job's record per chunk, all appended to the source's log.
		// SESSION-DELETION GUARD (wave 6): a chat deleted mid-run has no
		// usage log to append to — the record's death is the user's choice
		// and its partial spend logs with it (appendSourceUsage below
		// already no-ops for a vanished source; the chat path guards here).
		if (run.kind === "chat" && !chatStore.getChat(run.chatId)) return;
		const entry: ExtractionRunUsage = {
			startedAt: run.startedAt,
			at: new Date().toISOString(),
			durationMs,
			stats,
			stages: {
				extractor: run.usage.extractor ?? { model: "unknown", steps: [] },
			},
		};
		if (run.kind === "notes") storeFor(run.chatId).appendSourceUsage(run.chatId, entry);
		else chatStore.appendExtractionUsage(run.chatId, entry);
	}

	/** One chunk/batch JOB (per-chunk jobs, owner 2026-09-28): the registry
	 *  entry's lifecycle — minted with its part, usage persisted per job
	 *  (the ledger shows each chunk's cost), removed on any exit. The body
	 *  runs the full lock → extract → merge lifecycle;
	 *  failure isolation lives at the fan-out site (one bad chunk never
	 *  kills its siblings). */
	async function runJob(
		source: { id: string; kind: "chat" | "notes"; label?: string; part?: { i: number; n: number } },
		body: (jobKey: string) => Promise<EmissionStats>,
	): Promise<EmissionStats> {
		const jobKey = source.part ? `${source.id}#${source.part.i}` : source.id;
		const t0 = performance.now();
		try {
			const stats = await body(jobKey);
			persistRunUsage(jobKey, Math.round(performance.now() - t0), stats);
			return stats;
		} catch (err) {
			persistRunUsage(jobKey, Math.round(performance.now() - t0), undefined);
			throw err;
		} finally {
			finishExtraction(jobKey);
		}
	}

	/** The fan-out aggregation (per-chunk jobs, owner 2026-09-28): successes
	 *  count (earlier chunks keep their merges — checkpoints make aborts
	 *  cheap), aborts log and pass as partial stats, isolated failures log
	 *  per job and never throw — the source's run returns what actually
	 *  merged. */
	function aggregateJobs(sourceId: string, settled: PromiseSettledResult<EmissionStats>[]): EmissionStats {
		const stats: EmissionStats = { nodes: 0, chains: 0 };
		let aborted = false;
		let failed = 0;
		for (const result of settled) {
			if (result.status === "fulfilled") {
				stats.nodes += result.value.nodes;
				stats.chains! += result.value.chains ?? 0;
				// Simplification maintenance, summed like appends — but ABSENT
				// when nothing dropped (deep-equal pins read cleaner).
				if (result.value.droppedChains)
					stats.droppedChains = (stats.droppedChains ?? 0) + result.value.droppedChains;
				continue;
			}
			const err = result.reason;
			if (err instanceof Error && err.name === "AbortError") aborted = true;
			else {
				failed++;
				console.error(`[extraction ${sourceId}] job failed (isolated):`, err);
			}
		}
		if (aborted)
			console.info(
				`[extraction ${sourceId}] aborted — merged chunks keep their coverage, the rest stay uncovered for the next run`,
			);
		if (failed > 0)
			console.error(`[extraction ${sourceId}] ${failed} job(s) failed; successful jobs still merged`);
		return stats;
	}

	async function runExtraction(chatId: string): Promise<EmissionStats> {
		if (inFlight.has(chatId)) return { nodes: 0, chains: 0 };
		inFlight.add(chatId);
		const t0 = performance.now();
		// COVERAGE (vision-extraction-coverage.md, 2026-09-15): extract ONLY
		// what the per-chat coverage ledger doesn't already hold — never the
		// whole session. Batches are token-budgeted runs of the oldest
		// uncovered messages; each merged batch checkpoints its messages'
		// coverage ATOMICALLY (inside the merger's step 4), so an abort or
		// error below loses at most the in-flight batch — every earlier
		// batch stays covered, the rest stays visibly uncovered.
		try {
			const record = chatStore.getChat(chatId);
			if (!record) throw new Error(`Chat not found: ${chatId}`);
			// No engine = refuse BEFORE any stage runs (typed — the trigger
			// skips, routes surface 503).
			refuseIfStagesUnready();
			// The lesson's class graph, fixed for the whole run (a class
			// move is refused while extraction runs).
			const chatGraph = storeFor(chatId);
			const covered = coverageOf(record.messages, chatGraph.readCoverage(), chatId);
			const failedOutputCalls = failedOutputCallIds(record.messages);
			if (covered.uncovered.length === 0) {
				console.info(`[extraction ${chatId}] nothing uncovered — no-op`);
				return { nodes: 0, chains: 0 };
			}
			const chunkTokens = deps.getChunkTokens?.() ?? FACTORY_SETTINGS.graph.extractionChunkTokens;
			// The batcher's one rule (owner, Wave D): a tool-call message and
			// its result message(s) are INSEPARABLE — one chunk, covered
			// together, read together (core/coverage.ts batchRuns).
			const batches = batchRuns(covered.slots, covered.uncovered, chunkTokens);
			console.info(
				`[extraction ${chatId}] pipeline start — ${covered.uncoveredTokens} uncovered tok, ` +
					`${covered.uncoveredCount} messages, ${batches.length} batch(es) of ≤${chunkTokens} tok`,
			);
			// Every batch is its own job (registry row, usage record), run in
			// order: each batch's extractor reads what earlier batches merged.
			// A batch that fails is ISOLATED (its messages stay uncovered —
			// re-runnable); its siblings keep merging.
			const settled: PromiseSettledResult<EmissionStats>[] = [];
			for (const [batchIndex, batch] of batches.entries()) {
				const part = batches.length > 1 ? { i: batchIndex + 1, n: batches.length } : undefined;
				try {
					settled.push({
						status: "fulfilled",
						value: await runJob({ id: chatId, kind: "chat", part }, async (jobKey) => {
							// The batch's source view: TEACHER PROSE ONLY (owner,
							// 2026-09-28), each passage labeled with its ACTUAL message
							// id (2026-10-13) — the view lines ARE the coverage
							// fingerprints' messageViewLines ("TEACHER [id] text"), one
							// shared seam.
							const messages = batch.map((slot) => slot.message);
							const view = proseView(messages, record.title, failedOutputCalls);
							// The batch's teacher-prose ids — the ONLY anchors this
							// job's submit may name (validateSessionAnchors at the
							// submit seam refuses anything else: ids from other
							// batches — even real ones of this chat — other chats,
							// and non-prose messages).
							const batchIds = new Set(
								messages.filter((m) => messageViewLines(m, m.id, failedOutputCalls).length > 0).map((m) => m.id),
							);
							return withGraphLock(jobKey, "chat", undefined, part, async () => {
								setPhase(jobKey, "extracting", "chat", undefined, part);
								const findings = await extract(jobKey, chatId, view, batchIds);
								setPhase(jobKey, "merging", "chat", undefined, part);
								// SESSION-DELETION GUARD (wave 6): a chat deleted mid-run must never
								// merge. The deletion route aborts this run first and runs its purge
								// as one sync block; this closes the last window — a run that slipped
								// past the wind-down finds the chat gone HERE and rides the existing
								// abort path (info, not error): nothing merged, nothing checkpointed.
								if (!chatStore.getChat(chatId)) {
									const gone = new Error(`chat deleted mid-run: ${chatId}`);
									gone.name = "AbortError";
									throw gone;
								}
								// The batch's messages, snapshotted when the run computed
								// coverage — if a message mutates mid-run (a quiz answer
								// merges in), the stored fingerprint won't match its new
								// one and it re-opens: honest by construction.
								const foldedAt = new Date().toISOString();
								const batchStats = mergeFindings(chatId, findings, { chatStore, graphStore: chatGraph }, {
									foldedAt,
									coverage: batch
										.filter((slot) => slot.tokens > 0)
										.map((slot) => ({ chatId, fp: slot.fp, tokens: slot.tokens, foldedAt })),
								});
								console.info(
									`[extraction ${jobKey}] merged: ${batchStats.nodes} nodes, ${batchStats.chains ?? 0} chains`,
								);
								return batchStats;
							});
						}),
					});
				} catch (err) {
					settled.push({ status: "rejected", reason: err });
					// A source-wide abort (user abort / session deletion)
					// ends the WHOLE run: later batches would mint fresh,
					// un-aborted jobs and hang — stop here. Isolated
					// FAILURES keep going (siblings still merge).
					if (err instanceof Error && err.name === "AbortError") break;
				}
			}
			const stats = aggregateJobs(chatId, settled);
			console.info(
				`[extraction ${chatId}] merged: ${stats.nodes} nodes, ${stats.chains ?? 0} chains ` +
					`(${Math.round(performance.now() - t0)}ms total, ${batches.length} batch job(s))`,
			);
			return stats;
		} catch (err) {
			// Pre-fan-out failures only (stage gate, coverage read): aborts
			// and job-level failures are absorbed at the fan-out site, per
			// job — merged batches stay covered, partial usage persists per
			// job, the aggregate returns what actually merged.
			console.error(`[extraction ${chatId}] pipeline failed (${Math.round(performance.now() - t0)}ms):`, err);
			throw err;
		} finally {
			inFlight.delete(chatId);
			finishExtraction(chatId); // done or failed — no longer running
			notifyGraphWritten(storeFor(chatId));
		}
	}

	// ── the notes front door (format-agnostic: raw text in, same graph out) ──

	/** The raw source view the notes stages see: the file path + the text
	 *  VERBATIM. No message ids — provenance is the file itself. */
	function notesView(input: { filePath: string; text: string; part?: { i: number; n: number } }): string {
		const part = input.part && input.part.n > 1 ? ` (part ${input.part.i}/${input.part.n})` : "";
		return `SOURCE (the author's personal notes): ${input.filePath}${part}\n\n${input.text}`;
	}

	/** Chunk the notes text under the same budget the chat path uses
	 * (owner, 2026-09-28: the whole-file-in-one-call design collapsed a
	 * weak model — 26 propositions, structure bleed mid-emission).
	 * Greedy by line, chars/4 like every other estimate in the app; a
	 * single over-budget line rides alone (never split a line). */
	function chunkNotes(text: string, budget: number): string[] {
		if (text.trim().length === 0) return [];
		const out: string[] = [];
		let current = "";
		for (const line of text.split("\n")) {
			const candidate = current.length === 0 ? line : current + "\n" + line;
			if (current.length > 0 && Math.ceil(candidate.length / 4) > budget) {
				out.push(current);
				current = line;
			} else {
				current = candidate;
			}
		}
		if (current.trim().length > 0) out.push(current);
		return out;
	}

	async function notesExtract(
		jobKey: string,
		input: { id: string; filePath: string; text: string; part?: { i: number; n: number } },
	): Promise<NotesFindings> {
		// jobKey: the registry key ("src#i" for chunk jobs) so the abort
		// signal reaches the call; input.id stays the SOURCE id.
		const signal = runningExtractions.get(jobKey)?.controller.signal;
		signal?.throwIfAborted(); // an abort during a sync gap ends the job here
		const view = notesView(input);
		const { graph, context } = await promptContext(input.id, input.text);
		const prompt = context === "" ? view : `${context}\n\n${view}`;
		console.info(
			`[extraction ${jobKey}] notes extractor starting (${view.split("\n").length} source lines` +
				`${context === "" ? "" : `, context ${context.split("\n").length} lines`})`,
		);
		const t0 = performance.now();
		const findings = await runNotesExtractor(
			stageEngine("extractor", deps.extractor),
			extractionTaskLabel(jobKey),
			prompt,
			new Set(graph.nodes.map((n) => n.id)),
			signal,
			(usage, model, step, finishReason, tools) => {
				recordStep(jobKey, callUsage(usage), model);
				console.info(`[extraction] extractor step ${step}: ${finishReason}, tools: ${tools}`);
			},
		);
		console.info(`[extraction ${jobKey}] notes extractor done in ${Math.round(performance.now() - t0)}ms`);
		return findings;
	}

	async function runNotesExtraction(input: { id: string; filePath: string; text: string; importedAt: string }): Promise<EmissionStats> {
		const { id } = input;
		// importNotes owns the source exclusion, including metadata and cleanup.
		const t0 = performance.now();
		const mergedStats: EmissionStats = { nodes: 0, chains: 0 };
		try {
			// Same refusal as the chat front door: no engine, no run.
			refuseIfStagesUnready();
			// Chunked like the chat path: each chunk is its own extract →
			// merge, so no single call carries a whole large file. Abort
			// mid-run keeps earlier chunks merged.
			const chunkTokens = deps.getChunkTokens?.() ?? FACTORY_SETTINGS.graph.extractionChunkTokens;
			const chunks = chunkNotes(input.text, chunkTokens);
			console.info(
				`[extraction ${id}] notes pipeline start (${input.filePath}) — ${chunks.length} chunk(s) of ≤${chunkTokens} tok`,
			);
			// Chunks run in order (each reads what earlier chunks merged). The
			// part rides the registry entry (feed suffix "· i/N") only when
			// the file actually chunked.
			const settled: PromiseSettledResult<EmissionStats>[] = [];
			for (const [chunkIndex, chunk] of chunks.entries()) {
				const part = chunks.length > 1 ? { i: chunkIndex + 1, n: chunks.length } : undefined;
				// Keep the actual signal after runJob tears down its registry row:
				// usage persistence can throw and mask the body's AbortError.
				let chunkSignal: AbortSignal | undefined;
				try {
					settled.push({
						status: "fulfilled",
						value: await runJob({ id, kind: "notes", label: input.filePath, part }, async (jobKey) => {
							setPhase(jobKey, "waiting", "notes", input.filePath, part); // creates the row, so its signal exists
							chunkSignal = runningExtractions.get(jobKey)?.controller.signal;
							return withGraphLock(jobKey, "notes", input.filePath, part, async () => {
								setPhase(jobKey, "extracting", "notes", input.filePath, part);
								const findings = await notesExtract(jobKey, { ...input, text: chunk, part });
								setPhase(jobKey, "merging", "notes", input.filePath, part);
								const merged = mergeFindings(
									id,
									findings,
									{ chatStore, graphStore: storeFor(id) },
									{ foldedAt: input.importedAt },
								);
								// Capture the committed merge BEFORE usage can fail.
								mergedStats.nodes += merged.nodes;
								mergedStats.chains! += merged.chains ?? 0;
								if (merged.droppedChains)
									mergedStats.droppedChains = (mergedStats.droppedChains ?? 0) + merged.droppedChains;
								console.info(`[extraction ${jobKey}] merged: ${merged.nodes} nodes, ${merged.chains ?? 0} chains`);
								return merged;
							});
						}),
					});
				} catch (err) {
					let failure = err;
					if (chunkSignal?.aborted && !(err instanceof Error && err.name === "AbortError")) {
						// Notes-only: never start a fresh chunk after user cancellation,
						// even when usage cleanup replaced the original abort rejection.
						// Keep the secondary failure visible in the final import error.
						const aborted = new Error(`Notes import aborted; job cleanup failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
						aborted.name = "AbortError";
						failure = aborted;
					}
					settled.push({ status: "rejected", reason: failure });
					// Same source-wide-abort law as the chat door: stop the
					// run; isolated failures keep going.
					if (failure instanceof Error && failure.name === "AbortError") break;
				}
			}
			const stats = aggregateJobs(id, settled);
			// Completion is a chunk-status contract, never a node-count test.
			// Zero findings (and an empty file after the readiness gate) are valid.
			const rejected = settled.filter((r) => r.status === "rejected");
			if (rejected.length > 0 || settled.length !== chunks.length) {
				const aborted = rejected.some((r) => r.reason instanceof Error && r.reason.name === "AbortError");
				const outcome = aborted ? "aborted" : settled.some((r) => r.status === "fulfilled") ? "partial" : "failed";
				const details = rejected.map((r) => r.reason instanceof Error ? r.reason.message : String(r.reason)).join("; ");
				throw new NotesImportError(outcome, mergedStats, details || "Notes import did not complete");
			}
			console.info(
				`[extraction ${id}] merged: ${stats.nodes} nodes, ${stats.chains ?? 0} chains ` +
					`(${Math.round(performance.now() - t0)}ms total, ${chunks.length} chunk job(s))`,
			);
			return stats;
		} catch (err) {
			console.error(`[extraction ${id}] notes pipeline failed (${Math.round(performance.now() - t0)}ms):`, err);
			if (err instanceof NotesImportError || err instanceof NoEngineError) throw err;
			throw new NotesImportError(err instanceof Error && err.name === "AbortError" ? "aborted" : "failed", mergedStats,
				err instanceof Error ? err.message : String(err), { cause: err });
		} finally {
			finishExtraction(id); // done or failed — no longer running
		}
	}

	/** Every explicit import processes the whole file. Identity, graph context
	 * and usage history remain source-scoped; this is not exactly-once. */
	async function importNotes(input: NotesImportInput): Promise<EmissionStats> {
		const id = input.sourceId ?? `src_${crypto.createHash("sha256").update(input.filePath).digest("hex").slice(0, 12)}`;
		// Acquire BEFORE source upsert: overlapping contents must not alter metadata.
		if (inFlight.has(id)) throw new NotesImportError("busy", { nodes: 0, chains: 0 }, "This file is already being imported. Try again when it finishes.");
		inFlight.add(id);
		const target = input.graphStore ?? graphStore;
		sourceStores.set(id, target);
		try {
			const importedAt = new Date().toISOString();
			target.upsertSource({ id, filePath: input.filePath, importedAt });
			return await runNotesExtraction({ id, filePath: input.filePath, text: input.text, importedAt });
		} catch (err) {
			if (err instanceof NotesImportError || err instanceof NoEngineError) throw err;
			throw new NotesImportError("failed", { nodes: 0, chains: 0 }, err instanceof Error ? err.message : String(err), { cause: err });
		} finally {
			inFlight.delete(id);
			sourceStores.delete(id);
			notifyGraphWritten(target);
		}
	}

	function notifyGraphWritten(store: GraphStore): void {
		try {
			deps.onGraphWritten?.(store);
		} catch (err) {
			console.error("[extraction] onGraphWritten failed:", err);
		}
	}

	return { runExtraction, importNotes };
}

