import type { Usage } from "@earendil-works/pi-ai";
import {
	createPracticeAgent,
	createProberAgent,
	createTeacherAgent,
	type AgentBuildOptions,
	type TeachingAgent,
} from "../agent/teacher-agent.ts";
import { agentEngine } from "../agent/models.ts";
import { loadAgentCore } from "../agent/engine-load.ts";
import { createJobRunner } from "../agent/subagents/runner.ts";
import { createExtractionPipeline } from "../agent/subagents/extraction.ts";
import {
	deliverJobResult,
	noteSteersDurable,
	reconcileUserSteers,
	registerLiveAgent,
	setJobRespawn,
	setTurnRunner,
	settleSteers,
	unregisterLiveAgent,
} from "./jobs.ts";
import { runPiTurn } from "./pi/ui-stream.ts";
import { collectToolCallIds } from "./pi/call-ids.ts";
import { allGraphScopes, effectiveSettings, graphStoreFor, graphStoreForChat, scopeOfGraphStore, stores } from "./stores.ts";
import { scheduleTopicGrouping } from "./topics.ts";
import { classCardFor } from "./class-card.ts";
import type { ClassSearch } from "../agent/tools/class.ts";
import { readPassage, relatedFacts, searchClassFiles } from "./search-index.ts";
import { currentTodayNote, todayNoteFor } from "./today-note.ts";
import { extractionEnabled, graphToolsEnabled } from "../core/settings-resolution.ts";
import { learnerRulesSection } from "../core/teaching-areas.ts";
import { beginTurn, endTurn } from "./turn-liveness.ts";
import { applyParkedDismissal } from "./dismissal-park.ts";
import { registerTurn, rememberTurnFailure, unregisterTurn } from "./turn-runs.ts";
import { persistTurn, triggerExtraction, TurnPersistenceError } from "./turn-service.ts";
import { hasProbeDone, danglingQuestionOf } from "../core/native-messages.ts";
import { composeInstructions } from "../agent/teacher-agent.ts";
import { ensureCompacted, kickCompaction, effectiveThresholdTokens } from "./compaction.ts";
import { emit } from "../core/events.ts";
import { settledTurnResponse } from "./turn-runs.ts";
import { asAgentMessages } from "../core/native-messages.ts";
import {
	ChatInputError,
	inputAppends,
	parseChatInput,
	type TurnInput,
} from "../core/input-events.ts";
import { steerDelivered } from "../core/contracts.ts";
import type { AttachmentPart } from "../core/attachments.ts";
import { storeAttachments } from "./attachments.ts";
import type {CallUsage} from "../core/contracts.ts";

/**
 * One chat turn over the server-owned native record. Framework-free (plain
 * Request/Response) so tests can drive it directly with a scripted faux
 * engine — the Next route handler in src/app/api/chat is a one-line wrapper.
 *
 * THE INPUT-EVENTS CONTRACT: POST /api/chat
 * carries {chatId, input} — one explicit event (text / answer / verdict /
 * continue), never a client transcript. The server owns the record; this
 * module is the TURN COMPOSITION ROOT: it turns the event into native
 * record appends (core/input-events.ts), builds the agent from the record
 * (the record IS the agent state — state.messages = record.messages,
 * continue()), and runs the turn as a background object (pi/ui-stream.ts).
 * Wake-pipeline steers ride the same composition (TurnInput's steer kind).
 *
 * THE SAME COMPOSITION serves both entry points: client requests and the
 * wake pipeline's server-side steers (src/server/jobs.ts) — one code path
 * for write-ahead persistence, turn liveness, and the turn services.
 */

function settlementErrorText(error: unknown): string {
	return error instanceof TurnPersistenceError ? error.message : "An error occurred.";
}

const jobRunner = createJobRunner({
	chatStore: stores.chatStore,
	jobStore: stores.jobStore,
	deliver: deliverJobResult,
	// Every job runs on the outside agent.
	engineFor: () => agentEngine(),
});
/** The app's ONE extraction pipeline instance — both front doors share it:
 *  quiz-triggered session runs (turn-service) and notes imports
 *  (/api/graph/import) hit the same single-flight registry. */
export const extraction = createExtractionPipeline({
	...stores,
	// A lesson's facts land in ITS class's graph.
	graphStoreForChat,
	// Topics: a run that wrote a CLASS graph queues a
	// debounced topic-grouping run for that class ("No class" has none).
	onGraphWritten: (store) => {
		const scope = scopeOfGraphStore(store);
		if (typeof scope === "string") scheduleTopicGrouping(scope);
	},
	// Every stage runs on the outside agent.
	engineFor: () => agentEngine(),
	// The existing ideas each stretch's prompt carries, by local search.
	relatedFacts,
});


// Wake-pipeline wiring (contracts.ts "THE ASYNC PROTOCOL" §4): the pipeline
// delivers its steers through THIS composition root (one event: the steer
// marker, appended natively under the turn claim), and crash recovery
// re-spawns orphaned sub-agent loops through THIS runner.
setTurnRunner(async (chatId, input) => {
	const res = await handleChatInput(chatId, input);
	// Drive the stream to completion server-side — nobody else will read it,
	// and onFinish (persist, extraction, endTurn) only runs when it drains.
	await res.arrayBuffer().catch(() => undefined);
	return res.status;
});
setJobRespawn((jobId) => void jobRunner.runJob(jobId));

/** The lesson's class name and rules, for the learner's-rules section. */
function lessonClassRules(classId: string | undefined): { name: string; rules: string[] } | undefined {
	const cls = classId ? stores.classStore.getClass(classId) : null;
	return cls ? { name: cls.name, rules: cls.rules ?? [] } : undefined;
}

/** The route-facing entry: parse {chatId, input} and run one turn. */
export async function handleChatRequest(
	req: Request,
	buildAgent?: (opts: AgentBuildOptions & { teaching: boolean }) => TeachingAgent,
): Promise<Response> {
	let body: { chatId?: unknown; input?: unknown };
	try {
		body = await req.json();
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}
	const chatId = typeof body.chatId === "string" ? body.chatId : "";
	if (!chatId) return Response.json({ error: "Unknown chat" }, { status: 404 });
	let input: TurnInput;
	try {
		input = parseChatInput(body.input);
	} catch (err) {
		if (err instanceof ChatInputError) {
			return Response.json({ error: err.message }, { status: 400 });
		}
		throw err;
	}
	return handleChatInput(chatId, input, buildAgent);
}

/**
 * The turn composition: one input event → native record appends → one
 * agent turn as a background object. Also the wake pipeline's entry
 * (TurnInput's steer kind appends the marker under the same claim).
 */
export async function handleChatInput(
	chatId: string,
	input: TurnInput,
	buildAgent?: (opts: AgentBuildOptions & { teaching: boolean }) => TeachingAgent,
): Promise<Response> {
	let record = stores.chatStore.getChat(chatId);
	if (!record) {
		return Response.json({ error: "Unknown chat" }, { status: 404 });
	}

	// The learner's files, stored first: no await may sit between the
	// record read below and the write-ahead.
	let attachments: AttachmentPart[] = [];
	if ((input.type === "text" || input.type === "thinking") && input.attachments) {
		try {
			attachments = await storeAttachments(chatId, input.attachments);
		} catch (err) {
			if (err instanceof ChatInputError) return Response.json({ error: err.message }, { status: 400 });
			throw err;
		}
	}

	// The outside agent is the only model: no model or
	// connection gate. With no agent connected the turn simply waits in the
	// agent queue until one polls (the UI shows "Waiting for your agent").
	const effective = effectiveSettings();

	// THE COMPACTION GATE: NOTHING model-facing for this chat interleaves
	// with a running compaction. Await any in-flight compaction (the settle
	// kick usually finished inside the learner's answer pause), and if the
	// record is STILL over threshold, compact synchronously — this request
	// waits. Skipped under tests (the extraction precedent). It runs BEFORE
	// appends and beginTurn, so it has no liveness effects, and the record
	// re-reads after because compaction appends the marker.
	const conversationEngine = agentEngine();
	const modelIdForCompaction = `${conversationEngine.model.provider}:${conversationEngine.model.id}`;
	await ensureCompacted(
		{
			chatStore: stores.chatStore,
			engine: agentEngine(),
			canStart: () => true,
			modelId: modelIdForCompaction,
			kind: record.kind === "practice" ? "practice" : hasProbeDone(record.messages) ? "teach" : "probe",
			thresholdTokens: effectiveThresholdTokens(
				effective.compaction?.thresholdTokens,
				conversationEngine.model.contextWindow,
			),
			systemPromptTokens: Math.ceil(composeInstructions(record.kind === "practice" ? "practice" : "teacher").length / 4),
		},
		chatId,
	);
	const compactedRecord = stores.chatStore.getChat(chatId);
	if (!compactedRecord) return Response.json({ error: "Unknown chat" }, { status: 404 });
	record = compactedRecord;

	// The input's native appends (pure; the honest 400 for an answer with no
	// pending question call). Computed BEFORE beginTurn so a refused input
	// leaves no liveness effects; read against the CURRENT record. The idle
	// wake carries EVERY queued marker (steerDelivered filters a re-fire of an
	// already-landed one) - this wake input is the only steer appender; in-run
	// delivery rides pi's own follow-up queue and never builds an input event.
	let appends;
	try {
		appends =
			input.type === "steers"
				? input.steers.filter((s) => !steerDelivered(record.messages, s.id))
				: inputAppends(record, input, attachments);
	} catch (err) {
		if (err instanceof ChatInputError) {
			return Response.json({ error: err.message }, { status: 400 });
		}
		throw err;
	}

	// THE [Today] NOTE: when the lesson has none yet, the
	// day changed, the open deadlines changed, or a compaction cut the last
	// one, a fresh note goes right before the learner's message. Appended
	// only, so the outside agent still gets just the new tail. Learner
	// messages only (text, thinking, next): an answer must stay next to its
	// question call, and a wake or a continue carries no learner message.
	if (input.type === "text" || input.type === "thinking" || input.type === "next") {
		const note = todayNoteFor(record);
		if (note) appends = [...appends.slice(0, -1), note, ...appends.slice(-1)];
	}

	// THE PARALLEL-QUESTION GATE: an answer that leaves a SIBLING question
	// dangling defers its wake. The dock advances to the next question (the
	// client's optimistic result + record-changed carry the view); the LAST
	// answer fires the one reaction turn with every result ADJACENT to its
	// calling assistant message — the provider shape law (a tool result
	// appended after an intervening assistant message is rejected, which
	// would strand the sibling question). Nothing else can generate while a
	// question dangles (job wakes wait, continuation folds refuse, the
	// composer gates), so adjacency holds by construction.
	if (input.type === "answer" && danglingQuestionOf([...record.messages, ...appends]) !== null) {
		const merged = [...record.messages, ...appends];
		try { stores.chatStore.saveMessages(chatId, merged); }
		catch (err) {
			console.error(`[chat ${chatId}] write-ahead persist failed:`, err);
			return new Response("Your input could not be saved. Please try again.", { status: 500 });
		}
		emit("record-changed", { chatId });
		return settledTurnResponse(); // the cheap terminal — no beginTurn, no turn
	}

	// One turn per chat, ever. A second request while a turn runs means a
	// stale/remounted client raced a live one — letting it through would
	// double-run the teacher and clobber the first turn's persist.
	if (!beginTurn(chatId)) {
		console.info(`[chat ${chatId}] turn already in flight — request rejected`);
		return Response.json({ error: "A turn is already running for this session" }, { status: 409 });
	}

	// Write-ahead persistence: the input's native appends go on disk BEFORE
	// the turn starts - the learner's answer is durable the instant the
	// request arrives, and any remount, second tab, or server crash reads
	// truth instead of the pre-answer record. (The wake's markers
	// ride this same write-ahead - the pump de-queued them at fire, so this
	// is the ONLY copy ever appended.)
	const merged = [...record.messages, ...appends];
	const persistBaseCount = merged.length;
	try {
		stores.chatStore.saveMessages(chatId, merged);
	} catch (err) {
		console.error(`[chat ${chatId}] write-ahead persist failed:`, err);
		endTurn(chatId);
		return new Response("Your input could not be saved. Please try again.", { status: 500 });
	}
	// Visibility bookkeeping is not the canonical save. Its failure must
	// neither misreport a saved input as lost nor prevent the turn running.
	try {
		noteSteersDurable(chatId, merged);
	} catch (err) {
		console.error(`[chat ${chatId}] input visibility bookkeeping failed:`, err);
	}

	try {
		// Usage: one collector per request, fed by the agent's
		// message_end events. Every model call's usage lands in the chat record's
		// append-only turns log at onFinish — idempotent per turn id.
		const turnUsageId = crypto.randomUUID();
		const steps: CallUsage[] = [];
		const collectUsage = (usage: Usage) => {
			steps.push({
				inputTokens: usage.input,
				outputTokens: usage.output,
				cacheReadTokens: usage.cacheRead,
				cacheWriteTokens: usage.cacheWrite,
				cacheWrite1hTokens: usage.cacheWrite1h ?? 0,
				// Optional in pi's Usage — persisted as 0, never dropped.
				reasoningTokens: usage.reasoning ?? 0,
			});
		};

		// AGENT CONSTRUCTION BRANCH (docs/archive/probe-teach-split.md §2): the transcript
		// is the seam — a successful probe_done call in the record means the
		// probe is concluded: build the TEACHER (planning + the full toolset). Otherwise
		// the session is still probing: build the PROBER (quiz/ask + probe_done).
		// Both share this whole composition (write-ahead persist, liveness,
		// steers, usage, extraction) — only the agent differs.
		const teaching = hasProbeDone(merged);
		// (Built once above the compaction gate; reused verbatim.)
		const engine = conversationEngine;
		const modelId = `${engine.model.provider}:${engine.model.id}`;
		// Tests inject a factory: the agent is stateless per turn, so each
		// request builds a fresh one off the record — the factory mirrors that
		// seam exactly. The record IS the agent state (native messages;
		// the record's id field strips at the wire in toLlmMessages).
		// CROSS-STREAM SEAM: `toolToggles` rides the build opts as the user-level
		// DELTA map (absent key = enabled). The definitive toggleable set is
		// TOGGLEABLE_TOOLS — the sub-agent JOB tools (research/demo/visual/pdf;
		// quiz/ask/fs/plan/probe_done are always-on).
		const agentOpts: AgentBuildOptions = {
			engine,
			messages: asAgentMessages(merged),
			onUsage: collectUsage,
			toolToggles: effective.agent.tools,
			chatId,
			// Read per turn, like the tool delta: a rule added mid-lesson applies
			// on the next turn.
			learnerRules: learnerRulesSection(effective.agent.rules, lessonClassRules(record.classId)),
		};
		// PRACTICE BRANCH: a kind:"practice"
		// session builds the practitioner from turn 1 — no prober→teacher
		// split, no plan/question/job tools; the whole registry is
		// problem + conclude. buildAgent stays honored (the test seam is
		// uniform across kinds).
		// CLASS SCOPE: the lesson's class.
		// Writes (extraction, practice targets) stay in its OWN graph; the map
		// readers see every class (reads may cross classes, writes never do);
		// read_class serves its live card (lessons in a class only).
		const lessonScope = record.classId ?? null;
		const scopedGraphs = () =>
			allGraphScopes().map((g) => ({ className: g.name, graphStore: graphStoreFor(g.scope), own: g.scope === lessonScope }));
		const classCard =
			lessonScope === null
				? undefined
				: () => {
						const cls = stores.classStore.getClass(lessonScope);
						return cls ? classCardFor(cls) : null;
					};
		// read_class ends with the current [Today] note (built at call time).
		const todayNote = () => currentTodayNote(lessonScope ?? undefined);
		// search_class_files / read_passage over the lesson's class files.
		const classSearch: ClassSearch | undefined =
			lessonScope === null
				? undefined
				: { searchFiles: (query, limit) => searchClassFiles(lessonScope, query, limit), readPassage: (ref) => readPassage(lessonScope, ref) };
		// set_class_note: Halley's note on the class's cover.
		const classNote = (text: string): string => {
			if (lessonScope === null || !stores.classStore.getClass(lessonScope)) return "This lesson's class no longer exists.";
			stores.classStore.updateClass(lessonScope, { note: { text: text.trim(), at: new Date().toISOString() } });
			return "Saved. It shows on the class's cover.";
		};
		// The agent engine loads on the first turn, not at server start.
		if (!buildAgent) await loadAgentCore();
		const constructed: TeachingAgent = buildAgent
			? buildAgent({ ...agentOpts, teaching })
			: record.kind === "practice"
				? createPracticeAgent(
						{
							chatId,
							chatStore: stores.chatStore,
							// TARGET VALIDATION: the practice tools read the
							// WHOLE graph fresh per pose — targets validate against every
							// proposition, not just the session's picks (so pickless
							// sessions stay valid).
							// Targets are the lesson's OWN class graph (writes never cross
							// classes).
							graphNodes: () => graphStoreFor(record.classId ?? null).readNodes(),
							// THE RARELY-NEEDED SET: research + pdf jobs
							// (same runner/gating as the teacher's — research honestly
							// absent when no engine is live) and the map readers behind
							// the SAME settings gate as the prober's.
							jobs: {
								chatId,
								jobStore: stores.jobStore,
								spawn: (job, input) => void jobRunner.runJob(job.id, input),
								},
							...(graphToolsEnabled(effective)
								? { graph: { chatStore: stores.chatStore, graphStore: graphStoreFor(lessonScope), graphs: scopedGraphs } }
								: {}),
							...(classCard ? { classCard, todayNote, classSearch, classNote } : {}),
						},
						agentOpts,
					)
				: teaching
				? createTeacherAgent(
						{
							chatId,
							chatStore: stores.chatStore,
							jobStore: stores.jobStore,
							spawn: (job, input) => void jobRunner.runJob(job.id, input),
							...(classCard ? { classCard, todayNote, classSearch, classNote } : {}),
							// The registry drop's signal: no live engine
							// = no research tool in the teacher's registry.
						},
						agentOpts,
					)
				: createProberAgent(
						{
							chatId,
							chatStore: stores.chatStore,
							deliver: (steer) => void deliverJobResult(steer),
							// The prober carries research + pdf dispatch too, so its ctx
							// needs the same job wiring as the teacher's.
							jobStore: stores.jobStore,
							spawn: (job, input) => void jobRunner.runJob(job.id, input),
							// The map reader: the prober reads the learner's
							// knowledge graph through tools when the gate opens —
							// graph master switch AND the agent.graphTools toggle.
							...(graphToolsEnabled(effective) ? { graphStore: graphStoreFor(lessonScope), graphs: scopedGraphs } : {}),
							...(classCard ? { classCard, todayNote, classSearch, classNote } : {}),
						},
						agentOpts,
					);

		// A test-injected agent gets no usage collector (tests assert the
		// transcript, not usage); when it's ours, usage flows through
		// the factory's subscription (wired above via onUsage).
		// THE TURN AS A BACKGROUND OBJECT: runPiTurn executes decoupled from
		// this response — the POST stream is just the FIRST subscriber (a view).
		// A client disconnect cannot abort the turn; the remote kill is the abort
		// channel, and late views reattach via GET /api/chats/[id]/stream.
		// Steering: register the live agent BEFORE runPiTurn — the loop's start
		// steering-poll drains the queue SYNCHRONOUSLY inside that call, so a later
		// registration would miss it. Registration also steers any pending
		// registry markers into this run: a marker parked behind a just-answered
		// quiz rides THIS run's first LLM call. Settlement still cannot beat the
		// flow below: it needs a streamed response, which never happens inside
		// the constructor.
		registerLiveAgent(chatId, constructed, input.type !== "steers" && input.type !== "continue",
			input.type === "steers" ? new Set(appends.map((message) => message.id)) : undefined);
		const handle = runPiTurn({
			agent: constructed,
			// The coalescing window seam (COMPACTION LAW): tests
			// tighten it via LH_UPDATE_FLUSH_MS; production rides the 100ms
			// default in ui-stream.
			...(process.env.LH_UPDATE_FLUSH_MS ? { updateFlushMs: Number(process.env.LH_UPDATE_FLUSH_MS) } : {}),
			// Seed the uniquifier with every
			// tool-call id the record already holds — a provider that resets
			// ids per response (DeepSeek) then gets fresh unique ids for this
			// turn's calls at the wire boundary, on the wire, in the record,
			// and in the next turn's context alike.
			usedToolCallIds: new Set(collectToolCallIds(merged)),
			// Stream-level failures are provider/transport internals — masked,
			// like the SDK defaults. Tool-input validation messages never
			// route through here: they ride the error-result path and reach the
			// transcript directly (the retry context the model saw).
			onError: (error) => {
				console.error(`[chat ${chatId}] turn error:`, error);
				return "An error occurred.";
			},
			onSettleError: settlementErrorText,
			onSettleFailure: (error, reportedErrorText) => {
				// POST only acknowledges acceptance; the submitter may attach
				// after this turn has already failed and left the registry.
				rememberTurnFailure(chatId, reportedErrorText ?? settlementErrorText(error));
				endTurn(chatId);
				unregisterTurn(chatId);
				unregisterLiveAgent(chatId);
				// The canonical save may have succeeded before later bookkeeping
				// threw. Reconcile against actual durability, never replay input
				// merely because usage/extraction/other settlement work failed.
				const persisted = stores.chatStore.getChat(chatId)?.messages ?? [];
				reconcileUserSteers(chatId, persisted);
				settleSteers(chatId, persisted, true, constructed);
			},
			onFinish: (turnMessages, isAborted) => {
				// The record write is the agent's own final state —
				// the new messages are the slice past the merged base.
				const stamped = persistTurn(stores.chatStore, chatId, persistBaseCount, turnMessages, isAborted);
				noteSteersDurable(chatId, stores.chatStore.getChat(chatId)?.messages ?? stamped);
				// usage log append (idempotent per turn id) — the stats bar
				// refolds this on the client after the turn settles. The
				// provenance message is the turn's FIRST new assistant message.
				const response = stamped.find((m) => (m as { role?: string }).role === "assistant");
				if (response && steps.length > 0) {
					stores.chatStore.appendTurnUsage(chatId, {
						id: turnUsageId,
						messageId: response.id,
						at: new Date().toISOString(),
						model: modelId,
						steps,
					});
				}
				// GRAPH GATE: the write channel —
				// extraction — dies with the master switch.
				// PRACTICE: practice sessions write nothing —
				// no extraction, no graph, no coverage (the session itself
				// is the deliverable).
				if (record.kind !== "practice" && extractionEnabled(effective.graph)) {
					// Fresh per-turn read of the graph section's chunk budget: the
					// trigger compares against it and the pipeline's batches share it.
					triggerExtraction(
						{ chatStore: stores.chatStore, graphStore: graphStoreFor(record.classId ?? null) },
						extraction,
						chatId,
						effective.graph.extractionChunkTokens,
					);
				}
				// PARKED DISMISSAL: a dismissal that arrived
				// mid-turn was parked by the dismiss route (202); now that
				// persistTurn has landed the turn's messages, apply it against
				// real truth — BEFORE endTurn, so "turn-settled" guarantees a
				// subsequent fetch reads the dismissal already in the record
				// (the same ordering law as persistTurn itself).
				applyParkedDismissal(stores.chatStore, chatId);
				// LAST: a poller that sees not-in-flight must read an already-persisted
				// record — endTurn only after persistTurn has done its job.
				endTurn(chatId);
				// And only then does the turn stop being a running object: a
				// reattach that finds nothing must find the persisted record current —
				// the same ordering rule as endTurn.
				unregisterTurn(chatId);
				// Steer settlement: the live agent is dead (no more
				// followUp handoffs) - reconcile the steer registry against
				// what this run actually persisted (in-run injections
				// resolve; stranded markers return to pending), then let
				// the pump take any stragglers down the idle wake.
				unregisterLiveAgent(chatId);
				settleSteers(chatId, stamped, false, constructed);
				// Composer steers: delivered ids dropped, stranded
				// ones stay parked for the chat's next run (the registry is the
				// stranding safety net — the agent's undrained copy died above).
				reconcileUserSteers(chatId, stamped);
				// THE SETTLE KICK: the turn settled — if the
				// projection is now over threshold, the summary starts in the
				// background, INSIDE the learner's reading/answering pause
				// (question/problem poses end runs, so this moment is always a
				// between-runs window). The next turn's ensureCompacted gate
				// awaits whatever this leaves running; a lost engine or a
				// beneath-threshold record is a silent no-op. Skipped under
				// tests (the extraction precedent — scripted chats are
				// fixtures; the service itself is pinned directly).
				if (process.env.NODE_ENV !== "test")
					kickCompaction(() => {
						const fresh = effectiveSettings();
						const kickEngine = agentEngine();
						const kickModelId = `${kickEngine.model.provider}:${kickEngine.model.id}`;
						const freshRecord = stores.chatStore.getChat(chatId);
						if (!freshRecord) return null;
						return {
							chatStore: stores.chatStore,
							engine: kickEngine,
							canStart: () => true,
							modelId: kickModelId,
							kind: freshRecord.kind === "practice" ? "practice" : hasProbeDone(freshRecord.messages) ? "teach" : "probe",
							thresholdTokens: effectiveThresholdTokens(
								fresh.compaction?.thresholdTokens,
								kickEngine.model.contextWindow,
							),
							systemPromptTokens: Math.ceil(composeInstructions(freshRecord.kind === "practice" ? "practice" : "teacher").length / 4),
						};
					}, chatId);
			},
		});
		// The turn is now a live background object: register it so any view
		// can reattach (GET /api/chats/[id]/stream) or remotely abort it
		// (POST /api/activity/abort, kind "turn"). Registration after the
		// runPiTurn call is race-free: the agent loop only ticks in later
		// microtasks, so settle (and thus unregister) cannot beat us here.
		registerTurn(chatId, handle);
		// The POST does not hold the turn's SSE stream open: it acknowledges
		// acceptance and CLOSES; the submitter attaches through GET
		// /api/chats/[id]/stream — the same universal reattach wire a returning
		// visitor uses. The browser's 6-connections-per-origin pool is the scarce
		// resource: a submission must cost zero permanently-held slots beyond the
		// one live view. The turn itself is a server-side process — it never
		// needed this connection, only a view did.
		return Response.json({ ok: true });
	} catch (err) {
		// The turn never started (agent load, build or runPiTurn threw), so no
		// onFinish will fire — clear the registry or the chat stays locked.
		endTurn(chatId);
		// The live-agent registration (if it happened) dies with the
		// turn here too - nothing was handed (the loop never ticked).
		unregisterLiveAgent(chatId);
		console.error(`[chat ${chatId}] turn failed to start:`, err);
		return Response.json({ error: "Failed to start the turn" }, { status: 500 });
	}
}
