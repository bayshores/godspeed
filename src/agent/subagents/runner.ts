import type { PiEngine } from "../models.ts";
import {
	accumulateJobUsage,
	buildSubagentSteer,
	isSubagentFailure,
	piUsageToStep,
	type DemoResult,
	type DemoToolInput,
	type JobKind,
	type JobRecord,
	type JobUsage,
	type PdfResult,
	type PdfToolInput,
	type ResearchResult,
	type ResearchToolInput,
	type SteerMessage,
	type UsageStepLike,
	type VisualResult,
	type VisualToolInput,
} from "../../core/contracts.ts";
import { registerJobAbort, unregisterJobAbort } from "./aborts.ts";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ModelRole } from "../../config.ts";
import type { ChatStore, JobStore } from "../../core/ports.ts";
import { runDemoBuilder } from "./demo-builder.ts";
import { runPdfReaderAgent } from "./pdf-reader.ts";
import { runResearcherAgent } from "./researcher.ts";
import { runVisualMaker } from "./visual-maker.ts";

/**
 * The background job runner (contracts.ts "THE ASYNC PROTOCOL" §2–3), created
 * via createJobRunner({ chatStore, jobStore, deliver }) — the composition root
 * (chat-handler) injects the storage ports and the WAKE SEAM (the server-side
 * steer delivery, src/server/jobs.ts); this module never imports an adapter.
 *
 *   runJob(jobId) — runs the kind's sub-agent loop in the background
 *     (the job tools' execute fires this via the spawn seam, fire-and-forget),
 *     updating the job's activity line on every iteration. On completion the
 *     runner builds the STEER MESSAGE (buildSubagentSteer) and hands it to
 *     `deliver` without waiting. The worker's final outcome and pending
 *     delivery are saved together; the session owns delivery from then on.
 *
 *   On failure the result is the failure shape (empty html/svg + "FAILED: …"
 *   notes; research: failure brief) — and it STILL steers, because the
 *   teacher must learn the outcome. Failed delivery starts stay quietly
 *   pending and never rewrite the worker's computation outcome.
 */

/**
 * Test seam: the spawn wiring has no injection point at the tool layer, so
 * tests swap in a scripted pi engine here to keep job tests off the network.
 * Undefined in production. (The jobs spawn through the module-level KIND
 * runners, which read these at call time.)
 */
export const researchModelOverride: { current?: PiEngine } = {};
export const demoModelOverride: { current?: PiEngine } = {};
export const visualModelOverride: { current?: PiEngine } = {};
export const pdfModelOverride: { current?: PiEngine } = {};

/** The dispatch-time tool input (from src/agent/tools/jobs.ts schemas). */
type JobToolInput = ResearchToolInput | DemoToolInput | VisualToolInput | PdfToolInput;

interface JobRunnerDeps {
	chatStore: ChatStore;
	jobStore: JobStore;
	/**
	 * Hand a finished job's steer to the session delivery registry. The
	 * promise tracks durable marker acceptance, but the worker never waits
	 * on it. Its persisted pending obligation survives process restart.
	 */
	deliver: (steer: SteerMessage) => Promise<void>;
	/** The engine per role — production always passes the outside agent.
	 *  Test overrides (below) still win; with neither, runJob refuses the
	 *  spawn. */
	engineFor?: (role: ModelRole) => PiEngine | undefined;
}

interface JobRunner {
	/** Run one job's sub-agent loop to completion (background; never throws).
	 *  The tool input rides along from dispatch (the spawn fires mid-stream,
	 *  before the tool part is persisted). Recovery reads saved job input,
	 *  with transcript fallback for legacy jobs. Delivery is not awaited. */
	runJob(jobId: string, input?: JobToolInput): Promise<void>;
}

/** One job loop's injected machinery: the kill switch (real abort) and the
 * usage tap (every model call folds into JobRecord.usage as it completes). */
interface LoopContext {
	/** Fires when abortJob kills the run; abortSignal is passed into every
	 * model call so work stops mid-call, not at the next loop check. */
	abortSignal: AbortSignal;
	/** Fold one model call's usage into the job record (progress write). */
	onUsage: (step: UsageStepLike) => void;
}

/** The kind→role table: the engineFor injection key for each sub-agent
 * kind. */
const KIND_ROLE: Record<JobKind, ModelRole> = {
	research: "researcher",
	demo: "demoBuilder",
	visual: "visualMaker",
	pdf: "pdfReader",
};

/** The test override per kind, read at call time. */
const MODEL_OVERRIDE: Record<JobKind, { current?: PiEngine }> = {
	research: researchModelOverride,
	demo: demoModelOverride,
	visual: visualModelOverride,
	pdf: pdfModelOverride,
};

export function createJobRunner(deps: JobRunnerDeps): JobRunner {
	const { chatStore, jobStore, deliver } = deps;

	/** Running usage totals per live job (the loop's onUsage folds here,
	 * then writes through the job store so the poll sees progress). */
	const usageTotals = new Map<string, JobUsage>();

	function makeLoopContext(jobId: string, engine: PiEngine): LoopContext {
		// Provider-qualified stamp of the engine's actual model.
		const model = `${engine.model.provider}:${engine.model.id}`;
		// Real-kill wiring: the controller is what the abort endpoint fires
		// (aborts.ts registry); the signal rides into every model call.
		const controller = new AbortController();
		registerJobAbort(jobId, controller);
		return {
			abortSignal: controller.signal,
			onUsage: (step) => {
				const next = accumulateJobUsage(usageTotals.get(jobId), model, step);
				usageTotals.set(jobId, next);
				jobStore.updateJob(jobId, { usage: next }); // merge patch — status untouched
			},
		};
	}

	/** True while the job may still write terminal state (result, error,
	 * steer). False once abortJob has flipped it to error ("Aborted by learner") —
	 * the runner then unwinds silently; the abort path owns the record and
	 * the abort steer. */
	function stillRunning(jobId: string): boolean {
		return jobStore.getJob(jobId)?.status === "running";
	}

	/** The engine one job runs on: test override first (tests swap
	 *  scripted engines without touching deps), then the injected
	 *  engineFor. undefined = nothing to run on — runJob refuses below. */
	function pickEngine(kind: JobKind): PiEngine | undefined {
		return MODEL_OVERRIDE[kind].current ?? deps.engineFor?.(KIND_ROLE[kind]);
	}

	/** One sub-agent loop per kind; each runner narrows the union input
	 *  itself (dispatch-time inputs are kind-correct by construction). */
	const KIND_RUNNERS: Record<
		JobKind,
		(jobId: string, engine: PiEngine, input: JobToolInput | undefined, loop: LoopContext) => Promise<void>
	> = {
		research: runResearchJob,
		demo: runDemoJob,
		visual: runVisualJob,
		pdf: runPdfJob,
	};

	async function runJob(jobId: string, input?: JobToolInput): Promise<void> {
		const job = jobStore.getJob(jobId);
		if (!job) {
			console.error(`[job ${jobId}] not found — nothing to run`);
			return;
		}
		if (job.status !== "running") return; // already finished / re-run after crash recovery
		const run = KIND_RUNNERS[job.kind];
		if (!run) {
			console.error(`[job ${jobId}] unknown kind: ${job.kind}`);
			jobStore.updateJob(jobId, { status: "error", error: `unknown kind ${job.kind}`, activity: "failed" });
			return;
		}
		const engine = pickEngine(job.kind);
		// The refusal guard (no engine to run on) refuses through the SAME
		// convention as every other failed job: record the honest error (no
		// status flip: finalizeJob owns the terminal flip after delivery),
		// then steer the kind's failure shape through finishJob so the wake
		// pipeline resumes the lesson and the teacher reads the refusal
		// instead of waiting forever on a job it already dispatched.
		const refuse = async (reason: string): Promise<void> => {
			if (stillRunning(jobId)) jobStore.updateJob(jobId, { error: reason });
			await finishJob(jobId, failureResult(job.kind, resolveInput(job, input), reason));
		};
		if (!engine) {
			console.info(`[job ${jobId}] refused — no engine`);
			await refuse("No model is available to run this job");
			return;
		}
		try {
			await run(jobId, engine, input, makeLoopContext(jobId, engine));
		} finally {
			unregisterJobAbort(jobId);
			// The last usage write may have been mid-flight when the loop died;
			// persist what was folded (the abort path patches only status, so
			// this never resurrects an aborted job — merge patch).
			const usage = usageTotals.get(jobId);
			if (usage) jobStore.updateJob(jobId, { usage });
			usageTotals.delete(jobId);
		}
	}

	/** Dispatch input wins, then the job's saved arguments. Legacy jobs
	 * without saved input fall back to the durable transcript, which may
	 * lack a call if the dispatching turn died before settlement. */
	function resolveInput(
		job: JobRecord,
		input: JobToolInput | undefined,
	): JobToolInput | undefined {
		if (input) return input;
		if (job.input !== undefined) return job.input as JobToolInput;
		const chat = chatStore.getChat(job.chatId);
		if (!chat) return undefined;
		// The record is native history: a toolCall's arguments are the input.
		for (const m of chat.messages) {
			if ((m as { role?: string }).role !== "assistant") continue;
			const content = (m as { content?: unknown }).content;
			if (!Array.isArray(content)) continue;
			for (const block of content as Array<{ type?: string; id?: string; arguments?: unknown }>) {
				if (block.type !== "toolCall" || block.id !== job.toolCallId) continue;
				return block.arguments as JobToolInput | undefined;
			}
		}
		return undefined;
	}

	/**
	 * Save the computation outcome and session delivery obligation together.
	 * Worker liveness ends after cleanup, not after a lesson consumes the result.
	 */
	async function finishJob(jobId: string, result: ResearchResult | DemoResult | VisualResult | PdfResult): Promise<void> {
		const job = jobStore.getJob(jobId);
		if (!job) return;
		// Aborted mid-run (abortJob flips the record before
		// the loop unwinds): no result write, no steer — the abort path owns
		// the record and queues the abort steer itself.
		if (job.status !== "running") return;
		const failed = isSubagentFailure(job.kind, result);
		jobStore.updateJob(jobId, {
			result,
			status: failed ? "error" : "done",
			activity: failed ? "failed" : "finished",
			delivery: { kind: "result", status: "pending" },
		});
		// The saved result now belongs to the session. Do not keep the worker,
		// abort registration, or temporary resources alive behind a question.
		void deliver(buildSubagentSteer(job, result)).catch((err: unknown) => {
			console.error(`[job ${jobId}] pending delivery:`, err);
		});
	}

	/** Chat-record + input resolution shared by the runners. */
	function jobContext(jobId: string): { job: JobRecord; chatId: string } | null {
		const job = jobStore.getJob(jobId);
		if (!job || job.status !== "running") return null;
		const chat = chatStore.getChat(job.chatId);
		if (!chat) {
			jobStore.updateJob(jobId, { status: "error", error: `Chat not found: ${job.chatId}`, activity: "failed" });
			return null;
		}
		return { job, chatId: job.chatId };
	}

	// ─── research ───────────────────────────────────────────────────────────

	async function runResearchJob(
		jobId: string,
		engine: PiEngine,
		passedInput: JobToolInput | undefined,
		loop: LoopContext,
	): Promise<void> {
		const ctx = jobContext(jobId);
		if (!ctx) return;
		const { job } = ctx;

		const input = resolveInput(job, passedInput) as ResearchToolInput | undefined;
		if (!(typeof input?.question === "string" && input.question.trim())) {
			jobStore.updateJob(jobId, { error: "research question unavailable" });
			await finishJob(jobId, { brief: "Research failed: the research question is unavailable.", sources: [] });
			return;
		}
		const question = input.question;
		const context = typeof input?.context === "string" && input.context.trim() ? input.context : undefined;

		const prompt = [
			`Research question: ${question}`,
			context ? `Context (what this is needed for): ${context}` : null,
			"Produce your final brief in the required format.",
		]
			.filter(Boolean)
			.join("\n\n");

		const fetchedUrls: string[] = [];
		// Per-job PDF dir: web_fetch_pdf downloads land here; every pdf tool
		// is scoped to it; it dies with the job (never enters the record).
		const pdfDir = await fs.mkdtemp(path.join(os.tmpdir(), "lh-research-"));

		try {
			jobStore.updateJob(jobId, { activity: "researching" });
			const brief = await runResearcherAgent(prompt, {
				engine,
				pdfDir,
				abortSignal: loop.abortSignal,
				taskLabel: `Research · ${question}`,
				// Each agent step is one model call: fold its usage into the
				// record as it completes (progress write).
				onUsage: (usage) => loop.onUsage(piUsageToStep(usage)),
					onToolStart: (toolName, args) => {
					const input = args as { query?: string; url?: string } | undefined;
					if (typeof input?.url === "string" && (toolName === "web_fetch" || toolName === "web_fetch_pdf")) {
						fetchedUrls.push(input.url);
					}
					jobStore.updateJob(jobId, { activity: activityLine(toolName, input) });
				},
			});
			if (!brief.trim()) throw new Error("the researcher produced no text");
			const research: ResearchResult = { brief: brief.trim(), sources: parseSources(brief.trim(), fetchedUrls) };
			await finishJob(jobId, research);
		} catch (err) {
			// Real-kill abort: the abort path flipped the record and
			// queued the abort steer — unwind silently, keep the usage
			// folded so far (flushed by runJob's finally).
			if (loop.abortSignal.aborted) return;
			const reason = err instanceof Error ? err.message : String(err);
			if (stillRunning(jobId)) jobStore.updateJob(jobId, { error: reason });
			await finishJob(jobId, failureResult("research", input, reason));
		} finally {
			await fs.rm(pdfDir, { recursive: true, force: true });
		}
	}

	// ─── demo + visual ──────────────────────────────────────────────────────

	async function runDemoJob(
		jobId: string,
		engine: PiEngine,
		passedInput: JobToolInput | undefined,
		loop: LoopContext,
	): Promise<void> {
		const ctx = jobContext(jobId);
		if (!ctx) return;
		const { job } = ctx;

		const input = resolveInput(job, passedInput) as DemoToolInput | undefined;
		const title = typeof input?.title === "string" && input.title.trim() ? input.title : "Interactive demo";
		const brief = typeof input?.brief === "string" ? input.brief : "";

		try {
			jobStore.updateJob(jobId, { activity: "building demo" });
			const result = await runDemoBuilder(
				{ title, brief },
				{
					engine,
					abortSignal: loop.abortSignal,
					onUsage: (usage) => loop.onUsage(piUsageToStep(usage)),
					onActivity: (line) => jobStore.updateJob(jobId, { activity: line }),
				},
			);
			if (isDemoFailure(result) && stillRunning(jobId))
				jobStore.updateJob(jobId, { error: result.notes ?? "demo build failed" });
			await finishJob(jobId, result);
		} catch (err) {
			if (loop.abortSignal.aborted) return;
			const reason = err instanceof Error ? err.message : String(err);
			if (stillRunning(jobId)) jobStore.updateJob(jobId, { error: reason });
			await finishJob(jobId, failureResult("demo", input, reason));
		}
	}

	async function runVisualJob(
		jobId: string,
		engine: PiEngine,
		passedInput: JobToolInput | undefined,
		loop: LoopContext,
	): Promise<void> {
		const ctx = jobContext(jobId);
		if (!ctx) return;
		const { job } = ctx;

		const input = resolveInput(job, passedInput) as VisualToolInput | undefined;
		const brief = typeof input?.brief === "string" ? input.brief : "";

		try {
			jobStore.updateJob(jobId, { activity: "drawing figure" });
			const result = await runVisualMaker(
				{ brief },
				{
					engine,
					abortSignal: loop.abortSignal,
					onUsage: (usage) => loop.onUsage(piUsageToStep(usage)),
					onActivity: (line) => jobStore.updateJob(jobId, { activity: line }),
				},
			);
			if (isVisualFailure(result) && stillRunning(jobId))
				jobStore.updateJob(jobId, { error: result.notes ?? "visual build failed" });
			await finishJob(jobId, result);
		} catch (err) {
			if (loop.abortSignal.aborted) return;
			const reason = err instanceof Error ? err.message : String(err);
			if (stillRunning(jobId)) jobStore.updateJob(jobId, { error: reason });
			await finishJob(jobId, failureResult("visual", input, reason));
		}
	}

	// ─── pdf reading ─────────────────────────────────────────────────────────

	async function runPdfJob(
		jobId: string,
		engine: PiEngine,
		passedInput: JobToolInput | undefined,
		loop: LoopContext,
	): Promise<void> {
		const ctx = jobContext(jobId);
		if (!ctx) return;
		const { job } = ctx;

		const input = resolveInput(job, passedInput) as PdfToolInput | undefined;
		const path = typeof input?.path === "string" && input.path.trim() ? input.path.trim() : "";
		const question = typeof input?.question === "string" ? input.question : "";

		try {
			jobStore.updateJob(jobId, { activity: "reading pdf" });
			const result = await runPdfReaderAgent(
				{ path, question },
			{
				engine,
				abortSignal: loop.abortSignal,
				onUsage: (usage) => loop.onUsage(piUsageToStep(usage)),
				onActivity: (line) => jobStore.updateJob(jobId, { activity: line }),
			},
			);
			if (isPdfFailure(result) && stillRunning(jobId))
				jobStore.updateJob(jobId, { error: result.brief.replace(/^PDF failed:\s*/i, "") });
			await finishJob(jobId, result);
		} catch (err) {
			if (loop.abortSignal.aborted) return;
			const reason = err instanceof Error ? err.message : String(err);
			if (stillRunning(jobId)) jobStore.updateJob(jobId, { error: reason });
			await finishJob(jobId, failureResult("pdf", input, reason));
		}
	}

	return { runJob };
}

// ─── module-level pure helpers ──────────────────────────────────────────────

/** Each kind's failure shape, built from whatever input the job has. */
function failureResult(
	kind: JobKind,
	input: JobToolInput | undefined,
	reason: string,
): ResearchResult | DemoResult | VisualResult | PdfResult {
	switch (kind) {
		case "research":
			return { brief: `Research failed: ${reason}`, sources: [] };
		case "demo": {
			const title = (input as DemoToolInput | undefined)?.title;
			return {
				title: typeof title === "string" && title.trim() ? title : "Interactive demo",
				html: "",
				tested: true,
				notes: `FAILED: ${reason}`,
			};
		}
		case "visual":
			return { svg: "", notes: `FAILED: ${reason}` };
		case "pdf": {
			const pdf = input as PdfToolInput | undefined;
			return {
				path: typeof pdf?.path === "string" ? pdf.path.trim() : "",
				question: typeof pdf?.question === "string" ? pdf.question : "",
				brief: `PDF failed: ${reason}`,
				pagesRead: [],
				pagesConsulted: [],
			};
		}
	}
}

/** Failure shape: html === "" with "FAILED: …" notes. */
function isDemoFailure(result: DemoResult): boolean {
	return typeof result.html !== "string" || result.html.length === 0;
}

function isVisualFailure(result: VisualResult): boolean {
	return typeof result.svg !== "string" || result.svg.length === 0;
}

/** The pdf-reader's failure brief (mirrors the research failure shape). */
function isPdfFailure(result: PdfResult): boolean {
	return /^PDF failed:/i.test(result.brief);
}

/** The activity line shown in the UI: `web_fetch: host`. */
function activityLine(toolName: string, input: { url?: string } | undefined): string {
	if (toolName === "web_fetch") return `web_fetch: ${hostOf(input?.url)}`;
	return toolName;
}

function hostOf(url: string | undefined): string {
	if (!url) return "(no url)";
	try {
		return new URL(url).hostname;
	} catch {
		return url.slice(0, 40);
	}
}

/** Sources for the result: markdown links cited in the brief, else fetched URLs. */
function parseSources(brief: string, fetchedUrls: string[]): ResearchResult["sources"] {
	const sources: ResearchResult["sources"] = [];
	const seen = new Set<string>();
	for (const match of brief.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) {
		const title = (match[1] ?? "").trim();
		const url = match[2]!;
		if (!title || seen.has(url)) continue;
		seen.add(url);
		sources.push({ title, url });
	}
	if (sources.length === 0) {
		for (const url of fetchedUrls) {
			if (seen.has(url)) continue;
			seen.add(url);
			sources.push({ title: hostOf(url), url });
		}
	}
	return sources.slice(0, 10);
}
