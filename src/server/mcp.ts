/**
 * THE MCP SERVER: how outside agents (Claude Code, Codex, any MCP client)
 * reach godspeed. Served at /api/mcp (Streamable HTTP, stateless),
 * guarded by a bearer token (data/mcp-token — Settings → Outside agents).
 *
 * Two kinds of tools:
 *  - THE WORK LOOP (wait_for_work / respond): when a lesson, helper job, or
 *    graph-fact run uses the "Outside agent" model, the app parks the
 *    request in agent-bridge.ts; the agent takes it, answers it, repeats.
 *  - DIRECT ACCESS: list/read lessons, search the knowledge graph, import
 *    notes, start a lesson.
 */
import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {
	AGENT_MODEL_ID,
	AGENT_PROVIDER,
	agentConnected,
	pendingWorkCount,
	respondToWork,
	waitForWork,
	type WorkView,
} from "../agent/agent-bridge.ts";
import { getGraph } from "../core/graph.ts";
import { sessionMarkdown } from "../core/session-markdown.ts";
import { titleFromPrompt } from "../core/contracts.ts";
import { deleteMcpToken, readMcpToken, writeNewMcpToken } from "../store/mcp-token.ts";
import { extraction, handleChatInput } from "./chat-handler.ts";
import { stores } from "./stores.ts";
import { isTurnRunning } from "./turn-liveness.ts";
import packageMetadata from "../../package.json" with { type: "json" };

/** Codex's default MCP tool timeout is 60 s — every wait stays under it. */
const DEFAULT_WAIT_S = 45;
const MAX_WAIT_S = 55;
const READ_LIMIT_CHARS = 120_000;

const INSTRUCTIONS = `godspeed is a learning app. You can act as its AI: the teacher in lessons, and the worker behind its helpers (research, demos, diagrams, PDF reading) and its knowledge-graph builder — for any of those the learner has set to "Outside agent (MCP)".

The work loop:
1. Call wait_for_work. It returns a work item (or "idle" after a while — then call it again).
2. A work item holds "instructions" (your system prompt for this conversation — follow it exactly, it is the app's teaching method), "tools" (the tools you may call, with JSON schemas), and "messages" (the conversation so far). Later items in the same conversation have "continued": true and carry only the new messages.
3. Answer with respond: your text and/or tool calls, exactly as a model would. The app runs the tools and, when it needs you again in the same conversation (e.g. tool results), respond returns the next work item directly.
4. When respond says the turn is complete, the app is waiting on the learner (they read and answer in the godspeed window). Call wait_for_work again.

Keep looping until the user tells you to stop. Never invent tool names; use only the tools listed in the work item. The learner never sees text you write outside respond.`;

// ─── Access control ─────────────────────────────────────────────────────────

/** Token status for the settings screen. */
export function mcpAccessStatus(): { enabled: boolean; token: string | null; agentConnected: boolean; pendingWork: number } {
	const token = readMcpToken();
	return { enabled: token !== null, token, agentConnected: agentConnected(), pendingWork: pendingWorkCount() };
}

export function enableMcpAccess(): string {
	return readMcpToken() ?? writeNewMcpToken();
}
export const rotateMcpToken = writeNewMcpToken;
export const disableMcpAccess = deleteMcpToken;

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
	const expected = readMcpToken();
	if (!expected) return json(403, "Outside-agent access is off. Turn it on in godspeed: Settings → Outside agents.");
	const supplied = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
	if (!supplied || !tokenMatches(supplied, expected)) return json(401, "Missing or wrong access token (Settings → Outside agents).");
	return null;
}

// ─── Tool helpers ───────────────────────────────────────────────────────────

function result(value: unknown) {
	return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}
function failure(message: string) {
	return { content: [{ type: "text" as const, text: message }], isError: true };
}

/** Name the conversation a work item belongs to. */
function describe(view: WorkView) {
	const chat = stores.chatStore.getChat(view.conversation);
	const about = chat
		? { lessonId: chat.id, lessonTitle: chat.title, kind: chat.kind ?? "lesson" }
		: { kind: "background task (a helper job or knowledge-graph run)" };
	return { status: "work", workId: view.workId, ...about, continued: view.continued, ...(view.instructions !== undefined ? { instructions: view.instructions } : {}), ...(view.tools ? { tools: view.tools } : {}), messages: view.messages };
}

const IDLE = {
	status: "idle",
	note: "Nothing to do right now. Call wait_for_work again to keep waiting (the learner may be reading or answering).",
};

function waitMs(seconds: number | undefined): number {
	return Math.min(Math.max(seconds ?? DEFAULT_WAIT_S, 1), MAX_WAIT_S) * 1000;
}

function searchTerms(query: string): string[] {
	return query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
}

// ─── The server ─────────────────────────────────────────────────────────────

function buildServer(): McpServer {
	const server = new McpServer(
		{ name: "godspeed", version: packageMetadata.version },
		{ instructions: INSTRUCTIONS },
	);

	server.registerTool(
		"wait_for_work",
		{
			title: "Wait for work",
			description: "Wait for the next request from godspeed (a lesson turn, a helper job, or a knowledge-graph run). Returns a work item, or status \"idle\" if nothing arrived in time — then call again.",
			inputSchema: {
				timeout_seconds: z.number().int().min(1).max(MAX_WAIT_S).optional().describe(`How long to wait (default ${DEFAULT_WAIT_S}).`),
				lesson_id: z.string().optional().describe("Only take work from this lesson."),
				full_context: z.boolean().optional().describe("Send the whole conversation and instructions again, even if you saw them before (use after losing your context)."),
			},
		},
		async ({ timeout_seconds, lesson_id, full_context }) => {
			const view = await waitForWork(waitMs(timeout_seconds), { full: full_context, conversation: lesson_id });
			return result(view ? describe(view) : IDLE);
		},
	);

	server.registerTool(
		"respond",
		{
			title: "Respond to work",
			description: "Answer a work item the way a model would: text for the learner (or the task), and/or calls to the tools listed in the work item. Returns the next work item in the same conversation when the app needs you again right away (for example with tool results), or status \"turn_complete\".",
			inputSchema: {
				work_id: z.string().describe("The workId from wait_for_work or a previous respond."),
				text: z.string().optional().describe("Your message (markdown)."),
				tool_calls: z
					.array(z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()) }))
					.optional()
					.describe("Tool calls, run in order. Use only tools listed in the work item."),
				wait_seconds: z.number().int().min(0).max(MAX_WAIT_S).optional().describe("How long to wait for the follow-up (default 30)."),
			},
		},
		async ({ work_id, text, tool_calls, wait_seconds }) => {
			const answered = respondToWork(work_id, { text, toolCalls: tool_calls as { name: string; arguments: Record<string, never> }[] | undefined });
			if (!answered.ok) return failure(answered.error);
			const next = await waitForWork(Math.min(wait_seconds ?? 30, MAX_WAIT_S) * 1000, { conversation: answered.conversation });
			if (next) return result(describe(next));
			const chat = stores.chatStore.getChat(answered.conversation);
			return result({
				status: "turn_complete",
				note: chat
					? `Your turn is done. The learner is reading and will answer in the godspeed window. Call wait_for_work to continue (lesson_id "${chat.id}" to stay on this lesson).`
					: "The task step is done. Call wait_for_work for more.",
			});
		},
	);

	server.registerTool(
		"list_lessons",
		{
			title: "List lessons",
			description: "List the learner's lessons and practice sessions, newest first.",
			inputSchema: {},
			annotations: { readOnlyHint: true },
		},
		async () => {
			const lessons = stores.chatStore
				.listChats()
				.map((c) => ({
					id: c.id,
					title: c.title,
					kind: c.kind ?? "lesson",
					phase: c.phase,
					waitingForLearner: c.pendingQuestion || c.pendingProblem,
					running: isTurnRunning(c.id),
					model: c.settings?.model ? `${c.settings.model.provider}:${c.settings.model.id}` : null,
					updatedAt: c.updatedAt,
				}))
				.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
			return result({ lessons });
		},
	);

	server.registerTool(
		"read_lesson",
		{
			title: "Read a lesson",
			description: "Read one lesson as markdown: everything the teacher and learner said, quizzes and answers included.",
			inputSchema: { lesson_id: z.string() },
			annotations: { readOnlyHint: true },
		},
		async ({ lesson_id }) => {
			const record = stores.chatStore.getChat(lesson_id);
			if (!record) return failure(`No lesson "${lesson_id}". Use list_lessons.`);
			const markdown = sessionMarkdown(record.messages, { title: record.title, anchors: false });
			return result(markdown.length > READ_LIMIT_CHARS ? `${markdown.slice(-READ_LIMIT_CHARS)}\n\n[Showing the last ${READ_LIMIT_CHARS} characters.]` : markdown);
		},
	);

	server.registerTool(
		"search_graph",
		{
			title: "Search the knowledge graph",
			description: "Search the learner's knowledge graph: the facts (propositions) they have learned and the reasoning chains connecting them. Without a query, returns the most recent facts.",
			inputSchema: {
				query: z.string().optional().describe("Words to look for in fact names and statements."),
				limit: z.number().int().min(1).max(200).optional().describe("Most facts to return (default 30)."),
			},
			annotations: { readOnlyHint: true },
		},
		async ({ query, limit }) => {
			const graph = getGraph(stores.graphStore);
			const terms = searchTerms(query ?? "");
			const scored = graph.nodes
				.map((n) => {
					const haystack = [n.name, n.statement, ...n.aliases].join(" ").toLowerCase();
					return { node: n, score: terms.length ? terms.filter((t) => haystack.includes(t)).length : 1 };
				})
				.filter((s) => s.score > 0)
				.sort((a, b) => b.score - a.score || b.node.createdAt.localeCompare(a.node.createdAt))
				.slice(0, limit ?? 30);
			const picked = new Set(scored.map((s) => s.node.id));
			const names = new Map(graph.nodes.map((n) => [n.id, n.name]));
			const chains = graph.chains
				.filter((c) => picked.has(c.conclusion) || c.premises.some((p) => picked.has(p)))
				.slice(0, 100)
				.map((c) => `${c.premises.map((p) => names.get(p) ?? p).join(" + ")} ⟹ ${names.get(c.conclusion) ?? c.conclusion}`);
			return result({
				totalFacts: graph.nodes.length,
				facts: scored.map(({ node }) => ({ id: node.id, name: node.name, statement: node.statement })),
				chains,
			});
		},
	);

	server.registerTool(
		"import_notes",
		{
			title: "Import notes",
			description: "Add notes to the learner's knowledge graph. godspeed turns them into facts in the background with its graph-fact model; if that model is \"Outside agent\", the work arrives through wait_for_work. Returns right away.",
			inputSchema: {
				name: z.string().describe("A file-like name for the notes, e.g. \"biology-ch3.md\". Re-importing the same name replaces that import."),
				text: z.string().min(1).describe("The notes."),
			},
		},
		async ({ name, text }) => {
			extraction.importNotes({ filePath: name, text }).catch((err: unknown) => {
				console.error(`[mcp] import of ${name} failed:`, err);
			});
			return result({ status: "started", note: "Import started. Progress shows in the godspeed graph view." });
		},
	);

	server.registerTool(
		"start_lesson",
		{
			title: "Start a lesson",
			description: "Start a new lesson in godspeed taught by you (the outside agent). The topic becomes the learner's first message. Then call wait_for_work to teach it; the learner follows along in the godspeed window.",
			inputSchema: { topic: z.string().min(1).describe("What the learner wants to understand, in their words.") },
		},
		async ({ topic }) => {
			const chat = stores.chatStore.createChat(titleFromPrompt(topic));
			stores.chatStore.saveSettings(chat.id, { model: { provider: AGENT_PROVIDER, id: AGENT_MODEL_ID } });
			const started = await handleChatInput(chat.id, { type: "text", text: topic });
			if (!started.ok) {
				const body = await started.text();
				return failure(`The lesson was created but could not start: ${body}`);
			}
			return result({ status: "started", lessonId: chat.id, title: chat.title, note: `Open the lesson in the godspeed window. Call wait_for_work with lesson_id "${chat.id}" to begin teaching.` });
		},
	);

	return server;
}

/** The /api/mcp transport: one stateless server per request. */
export async function handleMcpRequest(req: Request): Promise<Response> {
	const refused = refuse(req);
	if (refused) return refused;
	const server = buildServer();
	const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
	await server.connect(transport);
	try {
		return await transport.handleRequest(req);
	} finally {
		// JSON mode answers in one response; nothing stays open.
		void server.close();
	}
}
