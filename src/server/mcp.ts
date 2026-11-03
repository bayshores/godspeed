/**
 * THE MCP SERVER: how outside agents (Claude Code, Codex, any MCP client)
 * reach godspeed. Served at /api/mcp (Streamable HTTP, stateless),
 * guarded by a bearer token (data/mcp-token — always present, shown in
 * Settings → Connection). It speaks both MCP versions: 2026-07-28 (every
 * request says who sent it; server/discover hands over the instructions)
 * and the older one that starts with initialize (Codex).
 *
 * Four kinds of tools:
 *  - THE WORK LOOP (wait_for_work / read_work / respond): every lesson turn, helper
 *    job, and graph-fact run parks its model request in agent-bridge.ts;
 *    the agent takes it, answers it, repeats.
 *  - DIRECT ACCESS: list/read lessons, search the knowledge graph and a
 *    class's files, import notes, start a lesson.
 *  - CLASSES: agents set up the learner's classes — create/edit/archive,
 *    add files, link folders, read them, start lessons inside them.
 *    Deleting a class is app-only on purpose: no tool here can wipe a class.
 *  - MEMORY: remember / forget save short notes about the learner; they
 *    and a "Where you left off" briefing follow the work loop in the
 *    instructions an agent gets when it connects, so it knows the learner
 *    in any folder.
 */
import { timingSafeEqual } from "node:crypto";
import { CLIENT_INFO_META_KEY, createMcpHandler, isLegacyRequest, McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
	agentConnected,
	agentName,
	agentTeaching,
	claimedLessons,
	displayAgentName,
	forgetAgent,
	fullWorkView,
	pendingWorkCount,
	readWorkPage,
	recordCheckIn,
	releaseConversation,
	respondToWork,
	setWorkPages,
	stayingOn,
	stayOn,
	waitForWork,
	type WorkView,
} from "../agent/agent-bridge.ts";
import { getGraph } from "../core/graph.ts";
import { pageBlocks, splitPages } from "../core/work-pages.ts";
import { sessionMarkdown } from "../core/session-markdown.ts";
import { CLASS_ICONS, parseClassScope, safeName, SIGNATURE_MAX, type ClassIcon, type ClassScope } from "../core/contracts.ts";
import { CLASS_ARG_TEXT, CLASS_TOOL_TEXT, DEADLINE_KINDS, FILE_KINDS, type ToolOutcome } from "../core/class-tools.ts";
import { ensureMcpToken, writeNewMcpToken } from "../store/mcp-token.ts";
import { handleChatInput } from "./chat-handler.ts";
import { catchUpForAgent } from "./agent-catch-up.ts";
import { extraction } from "./extraction.ts";
import { graphStoreFor, stores } from "./stores.ts";
import { addCopiedFile, AGENT_FILE_READING_REFUSAL, replaceCopiedFile, unlinkFolder } from "./classes.ts";
import { classActions, folderName, READING_NOTE } from "./class-actions.ts";
import { searchFacts } from "./search-index.ts";
import { createLesson } from "./lessons.ts";
import { noteAgentAction } from "./agent-actions.ts";
import { isTurnRunning } from "./turn-liveness.ts";
import { currentAgentBriefing } from "./agent-memory.ts";
import { addAgentNote, removeAgentNote } from "../store/agent-notes.ts";
import { NOTE_MAX_CHARS } from "../core/agent-notes.ts";
import { RULE_MAX_CHARS, TEACHING_AREAS, type AreaId } from "../core/teaching-areas.ts";
import { saveRuleByAgent } from "./agent-rules.ts";
import packageMetadata from "../../package.json" with { type: "json" };

/** Codex's default MCP tool timeout is 60 s, so the default wait stays
 *  under it. A client with a longer timeout (Codex started from the godspeed
 *  folder) may ask for longer waits, which saves it a model turn each. */
const DEFAULT_WAIT_S = 45;
const MAX_WAIT_S = 600;
/** respond's wait for a follow-up stays under Codex's default timeout. */
const RESPOND_MAX_WAIT_S = 55;
/** A message text this long goes in its own plain-text block, where its
 *  line breaks and quotes cost nothing; shorter ones stay in the JSON. */
const LONG_TEXT_CHARS = 1_000;

// Tool annotations. No tool reaches the open web, and only the REMOVES
// tools delete anything. ADDS tools do something new on every call.
const READ_ONLY = { readOnlyHint: true, openWorldHint: false };
const ADDS = { destructiveHint: false, idempotentHint: false, openWorldHint: false };
const SETS = { destructiveHint: false, idempotentHint: true, openWorldHint: false };
const REMOVES = { destructiveHint: true, idempotentHint: true, openWorldHint: false };


/** Claude Code cuts a server's instructions after this many characters,
 *  so the loop comes first and the briefing is sized for memory to end
 *  before the cut. The margin allows for a count that differs a little from ours. */
const INSTRUCTIONS_CUT = 4096;
const CUT_MARGIN = 96;

const INSTRUCTIONS = `godspeed is a learning app and you are its AI: the teacher in lessons, the worker behind its helpers (research, demos, diagrams, PDF reading) and its knowledge-graph builder.

The work loop:
1. Call wait_for_work. It returns a work item, or "idle" after a while; then call it again.
2. A work item is a JSON block with "tools" (what you may call) and "messages" (the conversation so far), then plain-text blocks: its instructions (your system prompt here, the app's teaching method; follow them exactly) and each long message text (the message reads "[text N]" and its block starts with "[text N]"). "continued": true means only new messages follow. "instructionsAsIn" and "toolsAsBefore" point at instructions and tool schemas you already got. A long item comes in pages: read every page with read_work before you respond. "[image N]" marks the images sent with the item, in order.
3. Answer with respond: text and/or tool calls, exactly as a model would. If the app needs you again right away (e.g. tool results), respond returns the next work item.
4. When respond says the turn is complete, the learner is answering in the godspeed window. Call wait_for_work again.

Lost track of a work item (context compacted, or missing the instructions or tools it refers to)? Call read_work with its work_id and full: true. Without the workId, call wait_for_work with full_context: true.

Loop until the user says stop. Use only the work item's tools, never invented ones, called through respond even when this server has one with the same name (like read_class): only then does the lesson keep what you looked up. The learner never sees text outside respond.`;

const MEMORY_INSTRUCTIONS = `Memory: "Where you left off" above is the learner's state when you connected; list_lessons and read_class have anything newer. When the learner tells you something outside a lesson that will matter next time (an exam is over, what to study next, how they like to learn), save it with remember, one fact per note, never passwords or private details. Remove out-of-date notes with forget.`;

// Last because each class tool's description says the same, so a client's cut loses least here.
const CLASS_INSTRUCTIONS = `Classes: the learner can sort learning into classes (university courses), each with its own lessons, knowledge graph, description and files. "study" files (notes, readings, transcripts, recordings) become graph facts; "info" files (syllabus, assignments, logistics) are only read by the teacher. godspeed sorts a linked folder's files into study and info itself. Take deadlines (exam, homework, quiz, project: a date, an optional time, the files they cover) from the syllabus or course info with add_class_deadline; change, tick done or remove them with update_class_deadline / remove_class_deadline. If a date, time or the covered files aren't clear, ask the learner instead of guessing. Teach inside a class with start_lesson and class_id; lessons without one are in "No class". Archived classes take no new lessons; ask the learner to unarchive one first. Only the godspeed window can delete a class.`;

// ─── Class arguments ────────────────────────────────────────────────────────

/** A tool's class_id argument, checked: absent / "none" = No class;
 *  otherwise the class must exist. Returns the scope or the refusal text. */
function classArg(classId: string | undefined): { scope: ClassScope } | { error: string } {
	const scope = parseClassScope(classId);
	if (scope === undefined) return { error: `"${classId}" is not a class id. Use list_classes.` };
	if (scope !== null && !stores.classStore.getClass(scope)) return { error: `No class "${classId}". Use list_classes.` };
	return { scope };
}

const SIGNATURE_ARG = z
	.object({
		kind: z.enum(["math", "code", "text"]),
		value: z.string().min(1).max(SIGNATURE_MAX),
	})
	.optional()
	.describe(CLASS_ARG_TEXT.signature);

const ICON_ARG = z.enum(Object.keys(CLASS_ICONS) as [ClassIcon, ...ClassIcon[]]).describe(CLASS_ARG_TEXT.icon);

const CLASS_ID_ARG = z
	.string()
	.optional()
	.describe('The class id from list_classes, or "none" for lessons without a class (the default).');

// ─── Access control ─────────────────────────────────────────────────────────

/** Token and agent status for the window (GET /api/mcp-access). */
export function mcpAccessStatus(): {
	token: string;
	agentConnected: boolean;
	agentTeaching: boolean;
	agentName: string | null;
	pendingWork: number;
	claimedLessons: { lessonId: string; claimedAt: string }[];
} {
	return {
		token: ensureMcpToken(),
		agentConnected: agentConnected(),
		agentTeaching: agentTeaching(),
		agentName: agentName() ?? null,
		pendingWork: pendingWorkCount(),
		claimedLessons: claimedLessons(),
	};
}

export const rotateMcpToken = writeNewMcpToken;

function tokenMatches(supplied: string, expected: string): boolean {
	const a = Buffer.from(supplied);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** null = allowed; otherwise the refusal response. */
function refuse(req: Request): Response | null {
	const json = (status: number, error: string) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
	// Only this computer: a page in a browser (which sends Origin) or a
	// request addressed to another host name (DNS rebinding) is refused.
	if (req.headers.get("origin")) return json(403, "Browser requests are not allowed.");
	const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
	if (!LOCAL_HOSTS.has(host)) return json(403, "Only local connections are allowed.");
	const expected = ensureMcpToken();
	const supplied = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
	if (!supplied || !tokenMatches(supplied, expected)) return json(401, "Missing or wrong access token (Settings → Connection).");
	return null;
}

// ─── Tool helpers ───────────────────────────────────────────────────────────

/** Compact JSON: indentation costs the agent tokens and tells it nothing. */
function result(value: unknown) {
	return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }] };
}

function textBlock(text: string) {
	return { type: "text" as const, text };
}

/** A work item as a tool result: its text blocks (describe), then its
 *  images as real MCP images (the "[image N]" markers point at them in
 *  order). A long item sends page 1 after a short header. */
function workResult(view: WorkView) {
	const images = (view.images ?? []).map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mimeType }));
	const pages = pageBlocks(describe(view));
	setWorkPages(view.workId, pages);
	const first = pages[0]!.map(textBlock);
	if (pages.length === 1) return { content: [...first, ...images] };
	const header = {
		status: "work",
		workId: view.workId,
		page: 1,
		pages: pages.length,
		note: `This work item is long, so it comes in ${pages.length} pages. Below is page 1. Read pages 2 to ${pages.length} with read_work before you respond.`,
	};
	return { content: [...result(header).content, ...first, ...images] };
}
function failure(message: string) {
	return { content: [{ type: "text" as const, text: message }], isError: true };
}

/** A work item as text blocks: compact JSON naming its conversation, then
 *  its instructions and long message texts as plain text, where line
 *  breaks, quotes and LaTeX backslashes need no escaping. */
function describe(view: WorkView): string[] {
	const chat = stores.chatStore.getChat(view.conversation);
	const about = chat
		? { lessonId: chat.id, lessonTitle: chat.title, kind: chat.kind ?? "teach" }
		: view.label
			? { kind: "background task", task: view.label }
			: { kind: "background task (a helper job or knowledge-graph run)" };
	const texts: string[] = [];
	const messages = view.messages.map((m) => {
		if (!m.text || m.text.length < LONG_TEXT_CHARS) return m;
		texts.push(`[text ${texts.length + 1}]\n${m.text}`);
		return { ...m, text: `[text ${texts.length}]` };
	});
	const byReference = view.instructionsAsIn !== undefined || view.toolsAsBefore !== undefined;
	const envelope = {
		status: "work",
		workId: view.workId,
		...about,
		continued: view.continued,
		...(view.instructionsAsIn ? { instructionsAsIn: view.instructionsAsIn } : {}),
		...(view.tools ? { tools: view.tools } : {}),
		...(view.toolsAsBefore ? { toolsAsBefore: view.toolsAsBefore } : {}),
		messages,
		...(view.images?.length ? { imageCount: view.images.length } : {}),
		...(byReference ? { note: "You already have what instructionsAsIn and toolsAsBefore point at. If you lost it, call read_work with this workId and full: true." } : {}),
	};
	const instructions = view.instructions ? [`Instructions (your system prompt for this conversation; follow them exactly):\n\n${view.instructions}`] : [];
	return [JSON.stringify(envelope), ...instructions, ...texts];
}

/** Waiting is free in Claude Code with the godspeed folder's waiter, and
 *  costs a model turn per call any other way. */
function inClaudeCode(caller: string | undefined): boolean {
	return caller === "Claude Code";
}

function waiterHint(lessonId?: string): string {
	return `Wait with the waiter, not by calling wait_for_work yourself: run node .godspeed/wait-for-work.mjs${lessonId ? ` --lesson ${lessonId}` : ""} in the background (CLAUDE.md in the godspeed folder has the exact command) and end your turn. It costs no tokens and wakes you when work arrives.`;
}

function idle(caller: string | undefined) {
	return {
		status: "idle",
		note: inClaudeCode(caller)
			? `Nothing to do right now. ${waiterHint()}`
			: "Nothing to do right now. Call wait_for_work again to keep waiting (the learner may be reading or answering).",
	};
}

/** The calling agent's session id, when its client sends one: the
 *  godspeed folder's connector and waiter set "godspeed/agent" in Claude Code,
 *  and Codex sends its session id in "x-codex-turn-metadata". Each agent
 *  then gets only the messages it hasn't seen. */
function agentIdOf(meta: Record<string, unknown> | undefined): string | undefined {
	let codex = meta?.["x-codex-turn-metadata"];
	if (typeof codex === "string") {
		try {
			codex = JSON.parse(codex);
		} catch {
			codex = undefined;
		}
	}
	const id = meta?.["godspeed/agent"] ?? (codex as { session_id?: unknown } | undefined)?.session_id;
	return typeof id === "string" && id.length > 0 && id.length <= 200 ? id : undefined;
}

function waitMs(seconds: number | undefined): number {
	return Math.min(Math.max(seconds ?? DEFAULT_WAIT_S, 1), MAX_WAIT_S) * 1000;
}

// ─── The server ─────────────────────────────────────────────────────────────

/** `caller` is the calling agent's name. `signal` aborts when the request's
 *  caller goes away, so its waits end without claiming work nobody will answer. */
function buildServer(instructions: string, signal: AbortSignal, caller: string | undefined): McpServer {
	const server = new McpServer(
		{ name: "godspeed", version: packageMetadata.version },
		// The tool list never changes, so clients don't hold a stream open to hear about it.
		{ instructions, capabilities: { tools: { listChanged: false } } },
	);

	server.registerTool(
		"wait_for_work",
		{
			title: "Wait for work",
			description: "Wait for the next request from godspeed (a lesson turn, a Talk message, a helper job, or a knowledge-graph run). Returns a work item, or status \"idle\" if nothing arrived in time — then call again.",
			inputSchema: z.object({
				timeout_seconds: z
					.number()
					.int()
					.min(1)
					.max(MAX_WAIT_S)
					.optional()
					.describe(`How long to wait in seconds (default ${DEFAULT_WAIT_S}, at most ${MAX_WAIT_S}). Stay under your client's tool timeout: for Codex that is its tool_timeout_sec (60 unless raised; the godspeed folder's start command sets 620).`),
				lesson_id: z.string().optional().describe("Stay on this lesson: take its turns and Talk messages, plus background jobs (file reading, graph building, helpers) so they never get stuck. Other lessons wait."),
				full_context: z.boolean().optional().describe("Send the whole conversation and instructions again, even if you saw them before (use after losing your context)."),
			}),
			annotations: ADDS,
		},
		async ({ timeout_seconds, lesson_id, full_context }, ctx) => {
			if (lesson_id && !stores.chatStore.getChat(lesson_id)) return failure(`No lesson "${lesson_id}". Use list_lessons.`);
			const agent = agentIdOf(ctx.mcpReq._meta);
			stayOn(agent, lesson_id);
			// Waiting counts the agent as working at once, so what godspeed queues
			// for it now (catch-up) reaches this same wait.
			const waiting = waitForWork(waitMs(timeout_seconds), { full: full_context, conversation: lesson_id, andBackground: true, agent, signal });
			catchUpForAgent();
			const view = await waiting;
			return view ? workResult(view) : result(idle(caller));
		},
	);

	server.registerTool(
		"respond",
		{
			title: "Respond to work",
			description: "Answer a work item the way a model would: text for the learner (or the task), and/or calls to the tools listed in the work item. Returns the next work item in the same conversation when the app needs you again right away (for example with tool results), or status \"turn_complete\".",
			inputSchema: z.object({
				work_id: z.string().describe("The workId from wait_for_work or a previous respond."),
				text: z.string().optional().describe("Your message (markdown)."),
				tool_calls: z
					.array(z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()) }))
					.optional()
					.describe("Tool calls, run in order. Use only tools listed in the work item."),
				wait_seconds: z.number().int().min(0).max(RESPOND_MAX_WAIT_S).optional().describe("How long to wait for the follow-up (default 30)."),
			}),
			annotations: ADDS,
		},
		async ({ work_id, text, tool_calls, wait_seconds }) => {
			const followUpMs = (wait_seconds ?? 30) * 1000;
			const answered = respondToWork(work_id, { text, toolCalls: tool_calls as { name: string; arguments: Record<string, never> }[] | undefined }, followUpMs);
			if (!answered.ok) return failure(answered.error);
			const lesson = stores.chatStore.getChat(answered.conversation);
			// The Talk chat has no page to go to; its replies show in the panel.
			if (lesson && lesson.kind !== "talk") noteAgentAction(caller, { label: `Replying in ${lesson.title}`, classId: lesson.classId ?? null, target: { kind: "lesson", id: lesson.id }, page: `/chat/${lesson.id}` });
			const next = await waitForWork(followUpMs, { conversation: answered.conversation, agent: answered.agent, signal }).finally(() => releaseConversation(answered.conversation));
			if (next) return workResult(next);
			const chat = stores.chatStore.getChat(answered.conversation);
			const claudeCode = inClaudeCode(caller);
			// A Talk reply goes back to the lesson the agent was staying on, not to Talk alone.
			const talk = chat?.kind === "talk";
			const lessonId = talk ? stayingOn(answered.agent) : chat?.id;
			const wait = claudeCode ? waiterHint(lessonId) : `Call wait_for_work to continue${lessonId ? ` (lesson_id "${lessonId}" to stay on this lesson)` : ""}.`;
			return result({
				status: "turn_complete",
				note: !chat
					? `The task step is done. ${claudeCode ? waiterHint() : "Call wait_for_work for more."}`
					: talk
						? `Your reply is in Talk. ${wait}`
						: `Your turn is done. The learner is reading and will answer in the godspeed window. ${wait}`,
			});
		},
	);

	server.registerTool(
		"read_work",
		{
			title: "Read more of a work item",
			description: "Read one page of a long work item, or (full: true) get the item again in full: its instructions, every tool and the whole conversation, for when you lost track of it. When a work item says it has several pages, read all of them before you respond.",
			inputSchema: z.object({
				work_id: z.string().describe("The workId of the work item."),
				page: z.number().int().min(1).optional().describe("The page to read, from 2."),
				full: z.boolean().optional().describe("Send the whole item again instead of one page (after your context was compacted, or when you no longer have the instructions or tools it refers to)."),
			}),
			annotations: READ_ONLY,
		},
		async ({ work_id, page, full }) => {
			if (full) {
				const again = fullWorkView(work_id);
				return again.ok ? workResult(again.view) : failure(again.error);
			}
			if (page === undefined) return failure("Give the page to read, or full: true.");
			const read = readWorkPage(work_id, page);
			if (!read.ok) return failure(read.error);
			const note = page < read.pages ? `Next: read_work page ${page + 1}.` : "That was the last page. Answer with respond.";
			return { content: [...result({ workId: work_id, page, pages: read.pages, note }).content, ...read.blocks.map(textBlock)] };
		},
	);

	server.registerTool(
		"list_lessons",
		{
			title: "List lessons",
			description: "List the learner's lessons and practice sessions, newest first, each with its class. total says how many match.",
			inputSchema: z.object({
				class_id: z.string().optional().describe('Only the lessons of this class (from list_classes), or "none" for lessons without a class. Leave it out for all lessons.'),
				limit: z.number().int().min(1).max(200).optional().describe("Most lessons to return (default 20)."),
			}),
			annotations: READ_ONLY,
		},
		async ({ class_id, limit }) => {
			let chats = stores.chatStore.listChats();
			if (class_id !== undefined) {
				const arg = classArg(class_id);
				if ("error" in arg) return failure(arg.error);
				chats = chats.filter((c) => (c.classId ?? null) === arg.scope);
			}
			const lessons = chats
				.map((c) => ({
					id: c.id,
					title: c.title,
					kind: c.kind,
					classId: c.classId ?? "none",
					className: c.classId ? (stores.classStore.getClass(c.classId)?.name ?? "Unknown class") : "No class",
					phase: c.phase,
					waitingForLearner: c.pendingQuestion || c.pendingProblem,
					running: isTurnRunning(c.id),
					updatedAt: c.updatedAt,
				}))
				.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
			return result({ lessons: lessons.slice(0, limit ?? 20), total: lessons.length });
		},
	);

	server.registerTool(
		"read_lesson",
		{
			title: "Read a lesson",
			description: "Read one lesson as markdown: everything the teacher and learner said, quizzes and answers included. A long lesson comes in pages; each page says which page it is and how many there are.",
			inputSchema: z.object({
				lesson_id: z.string(),
				page: z.number().int().min(1).optional().describe("The page to read (default 1)."),
			}),
			annotations: READ_ONLY,
		},
		async ({ lesson_id, page = 1 }) => {
			const record = stores.chatStore.getChat(lesson_id);
			if (!record) return failure(`No lesson "${lesson_id}". Use list_lessons.`);
			const pages = splitPages(sessionMarkdown(record.messages, { title: record.title, anchors: false }));
			if (page > pages.length) return failure(`This lesson has ${pages.length} page(s).`);
			if (pages.length === 1) return result(pages[0]!);
			const note = page < pages.length ? `Page ${page} of ${pages.length}. Next: read_lesson page ${page + 1}.` : `Page ${page} of ${pages.length}, the last.`;
			return { content: [...result({ lessonId: lesson_id, page, pages: pages.length, note }).content, { type: "text" as const, text: pages[page - 1]! }] };
		},
	);

	server.registerTool(
		"search_graph",
		{
			title: "Search the knowledge graph",
			description: "Search one class's knowledge graph (each class has its own): the facts (propositions) the learner has learned and the reasoning chains connecting them. Without a query, returns the most recent facts.",
			inputSchema: z.object({
				query: z.string().optional().describe("What to look for, in plain words (matched by meaning and by keywords)."),
				limit: z.number().int().min(1).max(200).optional().describe("Most facts to return (default 30)."),
				class_id: CLASS_ID_ARG,
			}),
			annotations: READ_ONLY,
		},
		async ({ query, limit, class_id }) => {
			const arg = classArg(class_id);
			if ("error" in arg) return failure(arg.error);
			const scope = arg.scope;
			const graph = getGraph(graphStoreFor(scope));
			const max = limit ?? 30;
			let found: typeof graph.nodes;
			if (query?.trim()) {
				const byId = new Map(graph.nodes.map((n) => [n.id, n]));
				try {
					found = (await searchFacts(scope, graph.nodes, query, max)).map((id) => byId.get(id)!);
				} catch (err) {
					return failure(err instanceof Error ? err.message : String(err));
				}
			} else {
				found = [...graph.nodes].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, max);
			}
			const picked = new Set(found.map((n) => n.id));
			const names = new Map(graph.nodes.map((n) => [n.id, n.name]));
			const chains = graph.chains
				.filter((c) => picked.has(c.conclusion) || c.premises.some((p) => picked.has(p)))
				.slice(0, 100)
				.map((c) => `${c.premises.map((p) => names.get(p) ?? p).join(" + ")} ⟹ ${names.get(c.conclusion) ?? c.conclusion}`);
			return result({
				totalFacts: graph.nodes.length,
				facts: found.map((node) => ({ id: node.id, name: node.name, statement: node.statement })),
				chains,
			});
		},
	);

	server.registerTool(
		"import_notes",
		{
			title: "Import notes",
			description: "Add notes to a knowledge graph. godspeed turns them into facts in the background; that work arrives through wait_for_work. Returns right away. With class_id the notes become a study file of that class (to add a file from disk, use add_class_file).",
			inputSchema: z.object({
				name: z.string().describe("A file-like name for the notes, e.g. \"biology-ch3.md\". In a class, re-importing the same name replaces that file and rebuilds its facts; in No class it is processed again and adds to that import."),
				text: z.string().min(1).describe("The notes."),
				class_id: CLASS_ID_ARG,
			}),
			annotations: ADDS,
		},
		async ({ name, text, class_id }) => {
			const arg = classArg(class_id);
			if ("error" in arg) return failure(arg.error);
			const scope = arg.scope;
			if (scope !== null) {
				// Compare as stored, so "week1/notes.md" finds "notes.md".
				const clean = safeName(name);
				const fileName = /\.(md|markdown|txt)$/i.test(clean) ? clean : `${clean}.md`;
				const bytes = new TextEncoder().encode(text);
				const existing = stores.classStore.getClass(scope)?.files.find((f) => f.origin === "copied" && f.name === fileName);
				const saved = existing ? replaceCopiedFile(scope, existing.id, bytes, "study") : addCopiedFile(scope, fileName, bytes, "study");
				if (!saved.ok) return failure(saved.error);
				noteAgentAction(caller, { label: `Reading ${fileName}`, classId: scope, target: { kind: "file", id: saved.value.id }, page: "/class/files" });
				return result({ status: "started", fileId: saved.value.id, note: `Import started. ${READING_NOTE}` });
			}
			noteAgentAction(caller, { label: `Reading ${name}`, classId: null, target: null, page: "/graph" });
			extraction.importNotes({ filePath: name, text }).catch((err: unknown) => {
				console.error(`[mcp] import of ${name} failed:`, err);
			});
			return result({ status: "started", note: `Import started. ${READING_NOTE}` });
		},
	);

	server.registerTool(
		"start_lesson",
		{
			title: "Start a lesson",
			description: "Start a new lesson (or practice session) in godspeed taught by you (the outside agent). The topic becomes the learner's first message. With class_id the lesson belongs to that class: it opens with the class's card and its facts go into that class's graph. Then call wait_for_work to teach it; the learner follows along in the godspeed window.",
			inputSchema: z.object({
				topic: z.string().min(1).describe("What the learner wants to understand (or practice), in their words."),
				class_id: CLASS_ID_ARG,
				kind: z.enum(["teach", "practice"]).optional().describe('"teach" (default) or "practice".'),
			}),
			annotations: ADDS,
		},
		async ({ topic, class_id, kind }) => {
			const arg = classArg(class_id);
			if ("error" in arg) return failure(arg.error);
			const scope = arg.scope;
			if (scope && stores.classStore.getClass(scope)?.archived) {
				return failure("This class is archived. Ask the learner to unarchive it in Edit class first.");
			}
			const created = createLesson({
				title: topic,
				kind: kind === "practice" ? "practice" : undefined,
				classId: scope,
			});
			if (!created.ok) return failure(created.error);
			const chat = created.chat;
			noteAgentAction(caller, { label: `Starting ${chat.title}`, classId: scope, target: { kind: "lesson", id: chat.id }, page: `/chat/${chat.id}` });
			const started = await handleChatInput(chat.id, { type: "text", text: topic });
			if (!started.ok) {
				const body = await started.text();
				return failure(`The lesson was created but could not start: ${body}`);
			}
			return result({ status: "started", lessonId: chat.id, title: chat.title, note: `Open the lesson in the godspeed window. ${inClaudeCode(caller) ? waiterHint(chat.id) : `Call wait_for_work with lesson_id "${chat.id}" to begin teaching.`}` });
		},
	);

	server.registerTool(
		"remember",
		{
			title: "Remember a note",
			description: `Save a short note about the learner. Every agent that connects to godspeed later sees it under "Where you left off", in any folder. Save what the learner tells you outside lessons that will matter next time: an exam that is over, what they plan to study next, how they like to learn. One fact per note, at most ${NOTE_MAX_CHARS} characters. Never save passwords or private details. The learner can see and delete notes in Settings → Connection.`,
			inputSchema: z.object({
				text: z.string().min(1).max(NOTE_MAX_CHARS).describe("The note, one line."),
				class_id: z.string().optional().describe("The class the note is about, if one (from list_classes)."),
			}),
			annotations: ADDS,
		},
		async ({ text, class_id }) => {
			const arg = classArg(class_id);
			if ("error" in arg) return failure(arg.error);
			const saved = addAgentNote(text, arg.scope ?? undefined);
			return saved.ok ? result({ note: saved.value }) : failure(saved.error);
		},
	);

	server.registerTool(
		"forget",
		{
			title: "Forget a note",
			description: 'Delete a saved note by its note_id (from "Where you left off" or from remember). Use it when a note is out of date or the learner asks.',
			inputSchema: z.object({ note_id: z.string() }),
			annotations: REMOVES,
		},
		async ({ note_id }) => (removeAgentNote(note_id) ? result({ removed: note_id }) : failure(`No note "${note_id}".`)),
	);

	server.registerTool(
		"save_rule",
		{
			title: "Save a teaching rule",
			description:
				"Save a rule about how godspeed's teacher teaches this learner, when they tell you a lasting preference (\"use Python for code examples\", \"shorter answers\"). " +
				"It joins the learner's rules in Settings, for every lesson or for one class's lessons, and applies from the next turn. Not for one-off requests or facts about the learner (use remember for those). " +
				"Don't ask first: the godspeed window shows it with Undo and Edit.",
			inputSchema: z.object({
				rule: z.string().min(1).max(RULE_MAX_CHARS).describe('One line, an instruction to the teacher, e.g. "Use Python for code examples."'),
				class_id: z.string().optional().describe("Only for this class's lessons (from list_classes). Leave it out for every lesson."),
				area: z
					.enum(TEACHING_AREAS.map((a) => a.id) as [AreaId, ...AreaId[]])
					.optional()
					.describe('For every lesson, the part of teaching it is about: "voice", "teaching" (the default), "questions", "facts", "demos" or "files" (files, formatting and code).'),
			}),
			annotations: ADDS,
		},
		async ({ rule, class_id, area }) => {
			const arg = classArg(class_id);
			if ("error" in arg) return failure(arg.error);
			const where = arg.scope ? { classId: arg.scope } : { area: area ?? ("teaching" as const) };
			const saved = saveRuleByAgent(rule, where, caller ?? "Your agent");
			return saved.ok ? result({ saved: saved.rule, for: saved.for, note: "The learner sees it in the godspeed window and can undo or edit it." }) : failure(saved.error);
		},
	);

	registerClassTools(server, caller);
	return server;
}

const FILE_KIND = z.enum(FILE_KINDS).describe(CLASS_ARG_TEXT.fileKind);
const DEADLINE_KIND = z.enum(DEADLINE_KINDS).describe(CLASS_ARG_TEXT.deadlineKind);

/** A class action's outcome as an MCP tool result. */
function reply(outcome: ToolOutcome) {
	return outcome.ok ? result(outcome.value) : failure(outcome.error);
}

function registerClassTools(server: McpServer, caller: string | undefined): void {
	const actions = classActions(caller);

	server.registerTool("list_classes", { title: "List classes", description: CLASS_TOOL_TEXT.list_classes, inputSchema: z.object({}), annotations: READ_ONLY }, async () => reply(actions.list_classes()));
	server.registerTool("read_class", { title: "Read a class", description: CLASS_TOOL_TEXT.read_class, inputSchema: z.object({ class_id: z.string(), files: z.boolean().optional().describe(CLASS_ARG_TEXT.files) }), annotations: READ_ONLY }, async (args) => reply(await actions.read_class(args)));
	server.registerTool("search_class_files", { title: "Search a class's files", description: CLASS_TOOL_TEXT.search_class_files, inputSchema: z.object({
			class_id: z.string(),
			query: z.string().min(1).describe(CLASS_ARG_TEXT.query),
			limit: z.number().int().min(1).max(20).optional().describe(CLASS_ARG_TEXT.limit),
		}), annotations: READ_ONLY }, async (args) => reply(await actions.search_class_files(args)));
	server.registerTool("read_passage", { title: "Read a passage of a class file", description: CLASS_TOOL_TEXT.read_passage, inputSchema: z.object({
			class_id: z.string(),
			passage_id: z.string().optional().describe(CLASS_ARG_TEXT.passageId),
			file_id: z.string().optional().describe(CLASS_ARG_TEXT.fileId),
			range: z.string().optional().describe(CLASS_ARG_TEXT.range),
		}), annotations: READ_ONLY }, async (args) => reply(await actions.read_passage(args)));
	server.registerTool("create_class", { title: "Create a class", description: CLASS_TOOL_TEXT.create_class, inputSchema: z.object({
			name: z.string().min(1).describe(CLASS_ARG_TEXT.name),
			description: z.string().optional().describe(CLASS_ARG_TEXT.description),
			signature: SIGNATURE_ARG,
			icon: ICON_ARG,
		}), annotations: ADDS }, async (args) => reply(await actions.create_class(args)));
	server.registerTool("update_class", { title: "Update a class", description: CLASS_TOOL_TEXT.update_class, inputSchema: z.object({
			class_id: z.string(),
			name: z.string().min(1).optional(),
			description: z.string().optional(),
			signature: SIGNATURE_ARG,
			icon: ICON_ARG.optional(),
			archived: z.boolean().optional(),
		}), annotations: SETS }, async (args) => reply(await actions.update_class(args)));
	server.registerTool("add_class_file", { title: "Add a file to a class", description: CLASS_TOOL_TEXT.add_class_file, inputSchema: z.object({ class_id: z.string(), path: z.string().describe(CLASS_ARG_TEXT.filePath), kind: FILE_KIND }), annotations: ADDS }, async (args) => reply(await actions.add_class_file(args)));
	server.registerTool("set_class_file_kind", { title: "Set class files' kind", description: CLASS_TOOL_TEXT.set_class_file_kind, inputSchema: z.object({ class_id: z.string(), file_ids: z.array(z.string()).min(1).describe(CLASS_ARG_TEXT.fileIds), kind: FILE_KIND }), annotations: REMOVES }, async (args) => reply(await actions.set_class_file_kind(args)));
	server.registerTool("add_class_deadline", { title: "Add deadlines to a class", description: CLASS_TOOL_TEXT.add_class_deadline, inputSchema: z.object({
			class_id: z.string(),
			deadlines: z
				.array(
					z.object({
						kind: DEADLINE_KIND,
						name: z.string().min(1).describe(CLASS_ARG_TEXT.deadlineName),
						date: z.string().describe(CLASS_ARG_TEXT.date),
						time: z.string().optional().describe(CLASS_ARG_TEXT.time),
						file_ids: z.array(z.string()).optional().describe(CLASS_ARG_TEXT.coveredFiles),
						left_out_ids: z.array(z.string()).optional().describe(CLASS_ARG_TEXT.leftOutFiles),
						source: z.string().optional().describe(CLASS_ARG_TEXT.source),
					}),
				)
				.min(1),
		}), annotations: ADDS }, async (args) => reply(await actions.add_class_deadline(args)));
	server.registerTool("update_class_deadline", { title: "Update a class deadline", description: CLASS_TOOL_TEXT.update_class_deadline, inputSchema: z.object({
			class_id: z.string(),
			deadline_id: z.string(),
			kind: DEADLINE_KIND.optional(),
			name: z.string().min(1).optional(),
			date: z.string().optional().describe("YYYY-MM-DD."),
			time: z.string().nullable().optional().describe(CLASS_ARG_TEXT.newTime),
			file_ids: z.array(z.string()).optional().describe(CLASS_ARG_TEXT.coveredFiles),
			left_out_ids: z.array(z.string()).optional().describe(CLASS_ARG_TEXT.leftOutFiles),
			source: z.string().nullable().optional().describe(CLASS_ARG_TEXT.source),
			done: z.boolean().optional(),
		}), annotations: SETS }, async (args) => reply(await actions.update_class_deadline(args)));
	server.registerTool("remove_class_deadline", { title: "Remove a class deadline", description: CLASS_TOOL_TEXT.remove_class_deadline, inputSchema: z.object({ class_id: z.string(), deadline_id: z.string() }), annotations: REMOVES }, async (args) => reply(await actions.remove_class_deadline(args)));
	server.registerTool("link_class_folder", { title: "Link a folder to a class", description: CLASS_TOOL_TEXT.link_class_folder, inputSchema: z.object({ class_id: z.string(), path: z.string().describe(CLASS_ARG_TEXT.folderPath) }), annotations: SETS }, async (args) => reply(await actions.link_class_folder(args)));

	server.registerTool(
		"unlink_class_folder",
		{
			title: "Unlink a class's folder",
			description: "Unlink the class's folder: its files leave the class together with their facts. The folder itself is not touched.",
			inputSchema: z.object({ class_id: z.string() }),
			annotations: REMOVES,
		},
		async ({ class_id }) => {
			const before = stores.classStore.getClass(class_id);
			if (!before) return failure(`No class "${class_id}". Use list_classes.`);
			const outcome = unlinkFolder(class_id);
			if (!outcome.ok) return failure(outcome.code === "extraction_running" ? AGENT_FILE_READING_REFUSAL : outcome.error);
			noteAgentAction(caller, { label: `Unlinking ${folderName(before.linkedFolder)}`, classId: class_id, target: { kind: "class", id: class_id }, page: "/class/files" });
			return result({ classId: class_id, unlinked: before.linkedFolder, filesRemoved: before.files.filter((f) => f.origin === "linked").length });
		},
	);
}

type ClientInfo = { name?: unknown; title?: unknown };

/** Who sent the request: the client's name (from initialize, or from a
 *  modern request's _meta), the client its _meta points to when it sends
 *  no name, and whether the request is one that hands the instructions
 *  over (initialize or server/discover). */
async function callerOf(req: Request): Promise<{ name: string | undefined; guessed: string | undefined; wantsInstructions: boolean }> {
	const caller = { name: undefined as string | undefined, guessed: undefined as string | undefined, wantsInstructions: false };
	try {
		const body: unknown = await req.clone().json();
		for (const message of Array.isArray(body) ? body : [body]) {
			const m = message as { method?: unknown; params?: { clientInfo?: ClientInfo; _meta?: Record<string, unknown> } } | null;
			const info = m?.method === "initialize" ? m.params?.clientInfo : (m?.params?._meta?.[CLIENT_INFO_META_KEY] as ClientInfo | undefined);
			caller.name ??= displayAgentName(info);
			caller.guessed ??= clientOfMeta(m?.params?._meta);
			if (m?.method === "initialize" || m?.method === "server/discover") caller.wantsInstructions = true;
		}
	} catch {
		/* not JSON: the transport reports it */
	}
	return caller;
}

/** Only Codex sends turn metadata, and only the godspeed folder's Claude
 *  Code connector and waiter send "godspeed/agent". */
function clientOfMeta(meta: Record<string, unknown> | undefined): string | undefined {
	if (meta?.["x-codex-turn-metadata"] !== undefined) return "Codex";
	if (meta?.["godspeed/agent"] !== undefined) return "Claude Code";
	return undefined;
}

/** /api/mcp/forget: the godspeed folder's Claude Code hook says an agent lost its
 *  context (it compacted, or "cleared": /clear ended the session), so its
 *  next items come in full. */
export async function handleAgentForget(req: Request): Promise<Response> {
	const refused = refuse(req);
	if (refused) return refused;
	const body = (await req.json().catch(() => null)) as { agent?: unknown; cleared?: unknown } | null;
	const agent = agentIdOf({ "godspeed/agent": body?.agent });
	if (!agent) return Response.json({ error: "Send the agent's session id as \"agent\"." }, { status: 400 });
	forgetAgent(agent, body?.cleared === true);
	return Response.json({ ok: true });
}

/** Each modern request's instructions and caller, for the modern handler's server factory. */
const modernRequests = new WeakMap<Request, { instructions: string; caller: string | undefined }>();

/** The 2026-07-28 era: every request carries the client's version, name
 *  and capabilities in _meta, and server/discover replaces initialize. JSON
 *  replies only, because the godspeed folder's scripts read one JSON body. */
const modern = createMcpHandler(
	({ requestInfo }) => {
		const req = requestInfo as Request;
		const known = modernRequests.get(req);
		return buildServer(known?.instructions ?? INSTRUCTIONS, req.signal, known?.caller);
	},
	{ legacy: "reject", responseMode: "json", onerror: logMcpError },
);

function logMcpError(error: Error): void {
	console.error("[mcp] request failed:", error);
}

/** What an agent gets on connecting: the loop, the briefing, then memory
 *  and classes. The briefing is sized so memory still ends before Claude
 *  Code's cut. (In Claude Code, the godspeed folder's CLAUDE.md says how to
 *  wait with the waiter.) */
function connectInstructions(): string {
	const before = INSTRUCTIONS.length + "\n\n".length;
	const after = "\n\n".length + MEMORY_INSTRUCTIONS.length;
	const briefing = currentAgentBriefing(INSTRUCTIONS_CUT - CUT_MARGIN - before - after);
	return [INSTRUCTIONS, briefing, MEMORY_INSTRUCTIONS, CLASS_INSTRUCTIONS].join("\n\n");
}

/** The /api/mcp transport: one stateless server per request, in either era. */
export async function handleMcpRequest(req: Request): Promise<Response> {
	const refused = refuse(req);
	if (refused) return refused;
	// Every authorized request means an agent is connected (only the work
	// loop means it is teaching), and names it when it says who it is.
	const caller = req.method === "POST" ? await callerOf(req) : null;
	if (caller) recordCheckIn({ name: caller.name });
	// Only a client's own name changes the shared one; a guess names just this request.
	const agent = caller?.name ?? caller?.guessed ?? agentName();
	// Only initialize and server/discover hand instructions to the agent, so only they build the briefing.
	const instructions = caller?.wantsInstructions ? connectInstructions() : INSTRUCTIONS;
	if (!(await isLegacyRequest(req))) {
		modernRequests.set(req, { instructions, caller: agent });
		return modern.fetch(req);
	}
	// The 2025 era starts with initialize (Codex still does). The SDK's own
	// fallback for it answers in SSE, so it keeps this JSON-mode transport.
	const server = buildServer(instructions, req.signal, agent);
	const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
	transport.onerror = logMcpError;
	await server.connect(transport);
	try {
		return await transport.handleRequest(req);
	} finally {
		// JSON mode answers in one response; nothing stays open.
		void server.close();
	}
}
