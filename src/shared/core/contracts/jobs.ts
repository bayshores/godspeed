/**
 * Sub-agent job contracts — the async ack-and-steer protocol.
 * Pure types + protocol docs + tiny pure helpers.
 */
import type { CallUsage } from "./chat.ts";

// ─── Async sub-agent jobs (vision §2.5) ─────────────────────────────────────

export type JobKind = "research" | "demo" | "visual" | "pdf";
type JobStatus = "running" | "done" | "error";

export interface JobRecord {
	id: string;
	kind: JobKind;
	chatId: string;
	/** The tool part this job fulfills. */
	toolCallId: string;
	/** Dispatch-time arguments, saved before spawn. Older jobs resolve from history. */
	input?: unknown;
	/** Session-owned delivery, independent of the worker's terminal outcome.
	 * Absent on legacy records: old terminal jobs must never be replayed. */
	delivery?: { kind: "result" | "abort"; status: "pending" | "delivered" };
	/** Worker computation only; a pending delivery does not keep it running. */
	status: JobStatus;
	/** Latest human-readable activity line, e.g. `web_fetch: en.wikipedia.org`. */
	activity: string;
	createdAt: string;
	updatedAt: string;
	/** The sub-agent's result (steer-artifact payload). */
	result?: unknown;
	error?: string;
	/** Accumulated token usage of the sub-agent's run, written by the runner
	 * as steps complete. Absent on older jobs and until the first step lands; renderers show
	 * "–", never zero. */
	usage?: JobUsage;
}

/** A sub-agent run's accumulated usage — the same accounting shape as a
 * chat turn (contracts/chat.ts CallUsage), flattened to one running total
 * plus a step count. Token fields are optional exactly like CallUsage: a
 * field NO model call reported stays undefined — absent is not zero
 * (renderers show "–"). */
export interface JobUsage {
	/** The model that ran the sub-agent, provider-qualified ("provider:id",
	 *  matching Pi catalog lookup keys). */
	model: string;
	/** Running totals summed over the run's model calls so far. */
	inputTokens: number | undefined;
	outputTokens: number | undefined;
	cacheReadTokens: number | undefined;
	cacheWriteTokens: number | undefined;
	reasoningTokens: number | undefined;
	cacheWrite1hTokens?: number;
	/** Individual calls. Absent on older jobs; never backfill them from
	 * cumulative totals. */
	calls?: CallUsage[];
	/** How many model calls the run has made. */
	steps: number;
	/** The MOST RECENT model call's accounting: the
	 *  per-blob context line reads last-step input+output against the
	 *  model's LIVE catalog limit (server-joined onto the activity feed —
	 *  never the cumulative totals, never a client-side table). Absent
	 *  until the first call completes; absent provider fields stay absent
	 *  (never zero). */
	lastStep?: CallUsage;
}

export interface ResearchResult {
	brief: string;
	sources: { title: string; url: string }[];
}

export interface DemoResult {
	title: string;
	/** Self-contained single-file HTML/JS document (sandboxed-iframe ready). */
	html: string;
	/** The builder sub-agent headlessly executed the demo before delivery. */
	tested: true;
	notes?: string;
}

export interface VisualResult {
	/** Complete SVG markup (verified by the maker looking at the render). */
	svg: string;
	notes?: string;
}

export interface PdfResult {
	path: string;
	question: string;
	/** The distilled brief. Page citations inside the text point at
	 *  pagesConsulted. Failure shape: /^PDF failed:/i (mirrors research). */
	brief: string;
	/** Pages the reader actually READ — extract or render output entered the
	 *  loop (the honest count for the UI badge; search-hit snippets don't
	 *  count, or a search-first read of a long book overstates it). */
	pagesRead: number[];
	/** Every page whose content entered the loop, search-hit context lines
	 *  included — the full audit set (the brief's citations may point here). */
	pagesConsulted: number[];
}

// ─── Sub-agent steer messages (THE ASYNC PROTOCOL §3–4) ─────────────────────
//
// Steers are NATIVE record messages —
// LhMarkerMessage customs (role "custom"), the custom-message taxonomy's
// wake members. The model-facing text rides `content` (single-sourced
// below); the UI payload (the artifact, the abort badge) rides `details`
// and never reaches the model (toLlmMessages maps the marker to a user
// message carrying `content` only). The deterministic id (`steer_<jobId>`)
// IS the idempotency key — steerDelivered matches on it.

/** Message metadata marking a sub-agent steer (contracts.ts §3). */
export interface SubagentResultMeta {
	jobId: string;
	kind: JobKind;
	toolCallId: string;
	/** Present only on an abort steer: the
	 * learner aborted the job (it lands as error "Aborted by learner");
	 * the teacher is told so its promise of a result doesn't hang
	 * silently in the lesson. */
	aborted?: true;
}

/** The data-subagent-artifact part payload: what the UI renders. */
export interface SubagentArtifactData {
	kind: JobKind;
	result: ResearchResult | DemoResult | VisualResult | PdfResult;
	/** The learner's pinned UI state (invert switch) riding the record. */
	ui?: { inverted?: boolean };
}

/** Whether a result is the failure shape (html/svg empty, failure brief). */
export function isSubagentFailure(
	kind: JobKind,
	result: ResearchResult | DemoResult | VisualResult | PdfResult,
): boolean {
	if (kind === "research") {
		const r = result as ResearchResult;
		return r.sources.length === 0 && /^Research failed:/i.test(r.brief);
	}
	if (kind === "demo") {
		const r = result as DemoResult;
		return typeof r.html !== "string" || r.html.length === 0;
	}
	if (kind === "pdf") {
		const r = result as PdfResult;
		return /^PDF failed:/i.test(r.brief);
	}
	const r = result as VisualResult;
	return typeof r.svg !== "string" || r.svg.length === 0;
}

