/**
 * THE MCP SERVER: how outside agents (Claude Code, Codex, any MCP client)
 * reach godspeed. Served at /api/mcp (Streamable HTTP, stateless),
 * guarded by a bearer token (data/mcp-token — always present, shown in
 * Settings → Connection).
 *
 * Four kinds of tools:
 *  - THE WORK LOOP (wait_for_work / respond): every lesson turn, helper
 *    job, and graph-fact run parks its model request in agent-bridge.ts;
 *    the agent takes it, answers it, repeats.
 *  - DIRECT ACCESS: list/read lessons, search the knowledge graph and a
 *    class's files, import notes, start a lesson.
 *  - CLASSES: agents set up the learner's classes — create/edit/archive,
 *    add files, link folders, read them, start lessons inside them.
 *    Deleting a class is app-only on purpose: no tool here can wipe a class.
 *  - MEMORY: remember / forget save short notes about the learner; they
 *    and a "Where you left off" briefing end the instructions an agent
 *    gets when it connects, so it knows the learner in any folder.
 */
import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {
	AGENT_MODEL_ID,
	AGENT_PROVIDER,
	agentConnected,
	agentName,
	displayAgentName,
	pendingWorkCount,
	recordCheckIn,
	releaseConversation,
	respondToWork,
	waitForWork,
	type WorkView,
} from "../agent/agent-bridge.ts";
import { getGraph } from "../core/graph.ts";
import { sessionMarkdown } from "../core/session-markdown.ts";
import { CLASS_ICONS, cleanSignature, parseClassScope, SIGNATURE_MAX, type ClassIcon, type ClassScope } from "../core/contracts.ts";
import { ensureMcpToken, writeNewMcpToken } from "../store/mcp-token.ts";
import { extraction, handleChatInput } from "./chat-handler.ts";
import { graphStoreFor, stores } from "./stores.ts";
import {
	addClassDeadline,
	addCopiedFile,
	addFileFromPath,
	classFilePath,
	createClass,
	linkFolder,
	removeClassDeadline,
	replaceCopiedFile,
	safeName,
	setFileKind,
	unlinkFolder,
	updateClass,
	updateClassDeadline,
} from "./classes.ts";
import { classTopics } from "./class-card.ts";
import { fileExtents, readPassage, searchClassFiles, searchFacts } from "./search-index.ts";
import { localToday } from "./progress.ts";
import { createLesson } from "./lessons.ts";
import { recordAgentAction, type AgentActionInput } from "./agent-actions.ts";
import { isTurnRunning } from "./turn-liveness.ts";
import { currentAgentBriefing } from "./agent-memory.ts";
import { addAgentNote, removeAgentNote } from "../store/agent-notes.ts";
import { NOTE_MAX_CHARS } from "../core/agent-notes.ts";
import packageMetadata from "../../package.json" with { type: "json" };

/** Codex's default MCP tool timeout is 60 s — every wait stays under it. */
const DEFAULT_WAIT_S = 45;
const MAX_WAIT_S = 55;
const READ_LIMIT_CHARS = 120_000;

const INSTRUCTIONS = `godspeed is a learning app, and you are its AI: the teacher in lessons, and the worker behind its helpers (research, demos, diagrams, PDF reading) and its knowledge-graph builder. All of the app's model work comes to you.

The work loop:
1. Call wait_for_work. It returns a work item (or "idle" after a while — then call it again).
2. A work item holds "instructions" (your system prompt for this conversation — follow it exactly, it is the app's teaching method), "tools" (the tools you may call, with JSON schemas), and "messages" (the conversation so far). Later items in the same conversation have "continued": true and carry only the new messages. Images in the messages appear as "[image N]"; the images themselves come with the work item, in that order.
3. Answer with respond: your text and/or tool calls, exactly as a model would. The app runs the tools and, when it needs you again in the same conversation (e.g. tool results), respond returns the next work item directly.
4. When respond says the turn is complete, the app is waiting on the learner (they read and answer in the godspeed window). Call wait_for_work again.

Keep looping until the user tells you to stop. Never invent tool names; use only the tools listed in the work item. The learner never sees text you write outside respond.

Classes: the learner can organize learning by class (a university course). Each class has its own lessons, its own knowledge graph, a description, and files. A file is either "study" material (notes, readings, transcripts, recordings: godspeed turns it into graph facts) or "info" (syllabus, assignments, logistics: the teacher can read it, it never becomes facts). A class can also link a folder on the learner's computer; new files there are added as study material automatically. A class can also have deadlines: exams, homework, quizzes and projects, each with a date, an optional time, and the class files it covers. Add them with add_class_deadline, and fix them, tick them done or remove them with update_class_deadline / remove_class_deadline. Take them from the syllabus or course info; when a date, time or the covered files aren't clear, ask the learner instead of guessing. Use list_classes / read_class to see them, create_class / update_class (name, description, a one-line signature for the class's cover, and a subject icon for the class switcher) / add_class_file / set_class_file_kind / link_class_folder to set them up, and start_lesson with class_id to teach inside one. Lessons without a class live in "No class". Every class needs a subject icon: create_class takes one, and when list_classes shows a class with icon null, set one with update_class without asking. Archived classes take no new lessons; ask the learner to unarchive one first. Classes can only be deleted in the godspeed window.

Memory: godspeed remembers for you, whatever folder you were started in. "Where you left off" below shows the learner's classes, last lessons, next deadlines and saved notes as of when you connected; use list_lessons / read_class for anything newer. When the learner tells you something outside a lesson that will matter next time (an exam is over, what they want to study next, how they like to learn), save it with remember, one fact per note. Never save passwords or private details. Remove notes that are out of date with forget.`;

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
	.describe(
		`The class's signature: ONE line that sums up the subject, shown huge on the class's cover. kind "math" = LaTeX without $ (math, physics, chemistry, economics), "code" = a line of code (programming classes), "text" = anything else (a line from a primary source, a sequence, a date). At most ${SIGNATURE_MAX} characters. Pick something iconic for the course; ask the learner when unsure.`,
	);

const ICON_ARG = z
	.enum(Object.keys(CLASS_ICONS) as [ClassIcon, ...ClassIcon[]])
	.describe(
		`The class's subject icon in the class switcher: ${Object.entries(CLASS_ICONS)
			.map(([icon, subject]) => `"${icon}" ${subject}`)
			.join(", ")}. Pick the closest subject.`,
	);

const CLASS_ID_ARG = z
	.string()
	.optional()
	.describe('The class id from list_classes, or "none" for lessons without a class (the default).');

// ─── Access control ─────────────────────────────────────────────────────────

/** Token status for the settings screen. */
export function mcpAccessStatus(): { token: string; agentConnected: boolean; agentName: string | null; pendingWork: number } {
	return { token: ensureMcpToken(), agentConnected: agentConnected(), agentName: agentName() ?? null, pendingWork: pendingWorkCount() };
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

/** Tell the window what the agent just changed (Halley). Never fails a tool. */
function act(input: AgentActionInput): void {
	try {
		recordAgentAction({ ...input, agent: agentName() ?? undefined });
	} catch (err) {
		console.error("[mcp] agent-action failed:", err);
	}
}

function deadlineName(classId: string, deadlineId: string): string {
	return stores.classStore.getClass(classId)?.deadlines?.find((d) => d.id === deadlineId)?.name ?? "a deadline";
}

function folderName(path: string | undefined): string {
	return path?.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "a folder";
}

function result(value: unknown) {
	return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

/** A work item as a tool result: the item as JSON, then its images as
 *  real MCP images (the "[image N]" markers point at them in order). */
function workResult(view: WorkView) {
	const images = (view.images ?? []).map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mimeType }));
	return { content: [...result(describe(view)).content, ...images] };
}
function failure(message: string) {
	return { content: [{ type: "text" as const, text: message }], isError: true };
}

/** Name the conversation a work item belongs to. */
function describe(view: WorkView) {
	const chat = stores.chatStore.getChat(view.conversation);
	const about = chat
		? { lessonId: chat.id, lessonTitle: chat.title, kind: chat.kind ?? "teach" }
		: view.label
			? { kind: "background task", task: view.label }
			: { kind: "background task (a helper job or knowledge-graph run)" };
	return { status: "work", workId: view.workId, ...about, continued: view.continued, ...(view.instructions !== undefined ? { instructions: view.instructions } : {}), ...(view.tools ? { tools: view.tools } : {}), messages: view.messages, ...(view.images?.length ? { imageCount: view.images.length } : {}) };
}

const IDLE = {
	status: "idle",
	note: "Nothing to do right now. Call wait_for_work again to keep waiting (the learner may be reading or answering).",
};

function waitMs(seconds: number | undefined): number {
	return Math.min(Math.max(seconds ?? DEFAULT_WAIT_S, 1), MAX_WAIT_S) * 1000;
}

// ─── The server ─────────────────────────────────────────────────────────────

function buildServer(instructions: string): McpServer {
	const server = new McpServer(
		{ name: "godspeed", version: packageMetadata.version },
		{ instructions },
	);

	server.registerTool(
		"wait_for_work",
		{
			title: "Wait for work",
			description: "Wait for the next request from godspeed (a lesson turn, a helper job, or a knowledge-graph run). Returns a work item, or status \"idle\" if nothing arrived in time — then call again.",
			inputSchema: {
				timeout_seconds: z.number().int().min(1).max(MAX_WAIT_S).optional().describe(`How long to wait (default ${DEFAULT_WAIT_S}).`),
				lesson_id: z.string().optional().describe("Stay on this lesson: take its turns, plus background jobs (file reading, graph building, helpers) so they never get stuck. Other lessons wait."),
				full_context: z.boolean().optional().describe("Send the whole conversation and instructions again, even if you saw them before (use after losing your context)."),
			},
		},
		async ({ timeout_seconds, lesson_id, full_context }) => {
			if (lesson_id && !stores.chatStore.getChat(lesson_id)) return failure(`No lesson "${lesson_id}". Use list_lessons.`);
			const view = await waitForWork(waitMs(timeout_seconds), { full: full_context, conversation: lesson_id, andBackground: true });
			return view ? workResult(view) : result(IDLE);
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
			const waitMs = Math.min(wait_seconds ?? 30, MAX_WAIT_S) * 1000;
			const answered = respondToWork(work_id, { text, toolCalls: tool_calls as { name: string; arguments: Record<string, never> }[] | undefined }, waitMs);
			if (!answered.ok) return failure(answered.error);
			const lesson = stores.chatStore.getChat(answered.conversation);
			if (lesson) act({ label: `Replying in ${lesson.title}`, classId: lesson.classId ?? null, target: { kind: "lesson", id: lesson.id }, page: `/chat/${lesson.id}` });
			const next = await waitForWork(waitMs, { conversation: answered.conversation }).finally(() => releaseConversation(answered.conversation));
			if (next) return workResult(next);
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
			description: "List the learner's lessons and practice sessions, newest first, each with its class.",
			inputSchema: {},
			annotations: { readOnlyHint: true },
		},
		async () => {
			const lessons = stores.chatStore
				.listChats()
				.map((c) => ({
					id: c.id,
					title: c.title,
					kind: c.kind,
					classId: c.classId ?? "none",
					className: c.classId ? (stores.classStore.getClass(c.classId)?.name ?? "Unknown class") : "No class",
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
			description: "Search one class's knowledge graph (each class has its own): the facts (propositions) the learner has learned and the reasoning chains connecting them. Without a query, returns the most recent facts.",
			inputSchema: {
				query: z.string().optional().describe("What to look for, in plain words (matched by meaning and by keywords)."),
				limit: z.number().int().min(1).max(200).optional().describe("Most facts to return (default 30)."),
				class_id: CLASS_ID_ARG,
			},
			annotations: { readOnlyHint: true },
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
			inputSchema: {
				name: z.string().describe("A file-like name for the notes, e.g. \"biology-ch3.md\". In a class, re-importing the same name replaces that file and rebuilds its facts; in No class it is processed again and adds to that import."),
				text: z.string().min(1).describe("The notes."),
				class_id: CLASS_ID_ARG,
			},
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
				act({ label: `Reading ${fileName}`, classId: scope, target: { kind: "file", id: saved.value.id }, page: "/class/files" });
				return result({ status: "started", fileId: saved.value.id, note: "Import started. Check progress with read_class." });
			}
			act({ label: `Reading ${name}`, classId: null, target: null, page: "/graph" });
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
			description: "Start a new lesson (or practice session) in godspeed taught by you (the outside agent). The topic becomes the learner's first message. With class_id the lesson belongs to that class: it opens with the class's card and its facts go into that class's graph. Then call wait_for_work to teach it; the learner follows along in the godspeed window.",
			inputSchema: {
				topic: z.string().min(1).describe("What the learner wants to understand (or practice), in their words."),
				class_id: CLASS_ID_ARG,
				kind: z.enum(["teach", "practice"]).optional().describe('"teach" (default) or "practice".'),
			},
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
				settings: { model: { provider: AGENT_PROVIDER, id: AGENT_MODEL_ID } },
			});
			if (!created.ok) return failure(created.error);
			const chat = created.chat;
			act({ label: `Starting ${chat.title}`, classId: scope, target: { kind: "lesson", id: chat.id }, page: `/chat/${chat.id}` });
			const started = await handleChatInput(chat.id, { type: "text", text: topic });
			if (!started.ok) {
				const body = await started.text();
				return failure(`The lesson was created but could not start: ${body}`);
			}
			return result({ status: "started", lessonId: chat.id, title: chat.title, note: `Open the lesson in the godspeed window. Call wait_for_work with lesson_id "${chat.id}" to begin teaching.` });
		},
	);

	server.registerTool(
		"remember",
		{
			title: "Remember a note",
			description: `Save a short note about the learner. Every agent that connects to godspeed later sees it under "Where you left off", in any folder. Save what the learner tells you outside lessons that will matter next time: an exam that is over, what they plan to study next, how they like to learn. One fact per note, at most ${NOTE_MAX_CHARS} characters. Never save passwords or private details. The learner can see and delete notes in Settings → Connection.`,
			inputSchema: {
				text: z.string().min(1).max(NOTE_MAX_CHARS).describe("The note, one line."),
				class_id: z.string().optional().describe("The class the note is about, if one (from list_classes)."),
			},
		},
		async ({ text, class_id }) => {
			if (class_id && !stores.classStore.getClass(class_id)) return failure(`No class "${class_id}". Use list_classes.`);
			const saved = addAgentNote(text, class_id);
			return saved.ok ? result({ note: saved.value }) : failure(saved.error);
		},
	);

	server.registerTool(
		"forget",
		{
			title: "Forget a note",
			description: 'Delete a saved note by its note_id (from "Where you left off" or from remember). Use it when a note is out of date or the learner asks.',
			inputSchema: { note_id: z.string() },
		},
		async ({ note_id }) => (removeAgentNote(note_id) ? result({ removed: note_id }) : failure(`No note "${note_id}".`)),
	);

	registerClassTools(server);
	return server;
}

/** This computer's date and time, "YYYY-MM-DD HH:MM" (deadlines are in
 *  the same local wall clock). */
function localNow(now = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${localToday(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** A class as agents see it: summary, files with paths, states and sizes,
 *  the graph's topics, deadlines, lessons. */
function classView(classId: string) {
	const record = stores.classStore.getClass(classId);
	if (!record) return null;
	const sizes = fileExtents(record.id);
	return {
		id: record.id,
		name: record.name,
		description: record.description,
		signature: record.signature ?? null,
		icon: record.icon ?? null,
		archived: record.archived,
		linkedFolder: record.linkedFolder ?? null,
		files: record.files.map((f) => ({
			id: f.id,
			name: f.name,
			kind: f.kind,
			origin: f.origin,
			status: f.status,
			...(f.error ? { error: f.error } : {}),
			...(sizes[f.id] ? { size: sizes[f.id] } : {}),
			path: classFilePath(record, f),
		})),
		topics: classTopics(record.id),
		today: localNow(),
		deadlines: (record.deadlines ?? []).map((d) => ({
			id: d.id,
			kind: d.kind,
			name: d.name,
			date: d.date,
			...(d.time !== undefined ? { time: d.time } : {}),
			done: d.done,
			files: d.fileIds.map((id) => ({ id, name: record.files.find((f) => f.id === id)?.name ?? id })),
		})),
		lessons: stores.chatStore
			.listChats()
			.filter((c) => c.classId === record.id)
			.map((c) => ({ id: c.id, title: c.title, kind: c.kind, updatedAt: c.updatedAt })),
	};
}

const FILE_KIND = z
	.enum(["study", "info"])
	.describe('"study" = study material turned into graph facts (notes, readings, transcripts, recordings); "info" = course info the teacher can read but that never becomes facts (syllabus, assignments, logistics).');

const DEADLINE_KIND = z.enum(["exam", "homework", "quiz", "project"]).describe("What the deadline is.");

function registerClassTools(server: McpServer): void {
	server.registerTool(
		"list_classes",
		{
			title: "List classes",
			description: "List the learner's classes (university courses), archived ones included, with file and lesson counts.",
			inputSchema: {},
			annotations: { readOnlyHint: true },
		},
		async () => {
			const lessons = stores.chatStore.listChats();
			const classes = stores.classStore.listClasses().map((c) => ({
				id: c.id,
				name: c.name,
				description: c.description,
				icon: c.icon ?? null,
				archived: c.archived,
				linkedFolder: c.linkedFolder ?? null,
				files: c.fileCount,
				lessons: lessons.filter((l) => l.classId === c.id).length,
			}));
			return result({ classes, noClassLessons: lessons.filter((l) => !l.classId).length });
		},
	);

	server.registerTool(
		"read_class",
		{
			title: "Read a class",
			description: "Read one class: its description, its files (kind, status, size, path on disk), the topics of its knowledge graph with their fact counts, its deadlines (kind, date, time, done, and the files each covers), its lessons, and today's local date and time. To find something inside the files, use search_class_files.",
			inputSchema: { class_id: z.string() },
			annotations: { readOnlyHint: true },
		},
		async ({ class_id }) => {
			const view = classView(class_id);
			return view ? result(view) : failure(`No class "${class_id}". Use list_classes.`);
		},
	);

	server.registerTool(
		"search_class_files",
		{
			title: "Search a class's files",
			description: "Search all of a class's files (readings, slides, transcripts, syllabus, assignments) by meaning and keywords. Returns the best passages, each with its id, file, place (page, time or lines) and a short snippet. Open the ones you need with read_passage instead of reading whole files.",
			inputSchema: {
				class_id: z.string(),
				query: z.string().min(1).describe("What to look for, in plain words."),
				limit: z.number().int().min(1).max(20).optional().describe("Most passages to return (default 8)."),
			},
			annotations: { readOnlyHint: true },
		},
		async ({ class_id, query, limit }) => {
			if (!stores.classStore.getClass(class_id)) return failure(`No class "${class_id}". Use list_classes.`);
			try {
				return result(await searchClassFiles(class_id, query, limit ?? 8));
			} catch (err) {
				return failure(err instanceof Error ? err.message : String(err));
			}
		},
	);

	server.registerTool(
		"read_passage",
		{
			title: "Read a passage of a class file",
			description: "Read one passage of a class file by its id from search_class_files, or a file's passages at a place (file_id + range, e.g. a whole page). Returns the text with the ids of the passages before and after it, to keep reading.",
			inputSchema: {
				class_id: z.string(),
				passage_id: z.string().optional().describe("A passage id from search_class_files (or a previous/next id)."),
				file_id: z.string().optional().describe("Instead of passage_id: a file id from read_class, with range."),
				range: z.string().optional().describe('With file_id: the place, e.g. "p. 12", "12:30" or "lines 40".'),
			},
			annotations: { readOnlyHint: true },
		},
		async ({ class_id, passage_id, file_id, range }) => {
			if (!stores.classStore.getClass(class_id)) return failure(`No class "${class_id}". Use list_classes.`);
			if (passage_id) return result(readPassage(class_id, { passageId: passage_id }));
			if (file_id && range) return result(readPassage(class_id, { fileId: file_id, range }));
			return failure("Give passage_id, or file_id with range.");
		},
	);

	server.registerTool(
		"create_class",
		{
			title: "Create a class",
			description: "Create a class for a course the learner is taking. The description is shown to the teacher in every lesson of the class: level, textbook, the professor's notation, what exams and assignments look like. Add the class's deadlines with add_class_deadline.",
			inputSchema: {
				name: z.string().min(1).describe('The course, e.g. "MATH 20C – Calculus III".'),
				description: z.string().optional().describe("What the teacher should know about the course, in the learner's terms."),
				signature: SIGNATURE_ARG,
				icon: ICON_ARG,
			},
		},
		async ({ name, description, signature, icon }) => {
			const sig = signature ? cleanSignature(signature) : undefined;
			if (sig === null) return failure(`A signature is one line of at most ${SIGNATURE_MAX} characters.`);
			const created = createClass({ name, description, icon, ...(sig ? { signature: sig } : {}) });
			act({ label: `Creating ${created.name}`, classId: created.id, target: { kind: "class", id: created.id }, page: "/class" });
			return result({ class: classView(created.id) });
		},
	);

	server.registerTool(
		"update_class",
		{
			title: "Update a class",
			description: "Rename a class, change its description, signature or icon, or archive / unarchive it (archiving hides it from the class switcher but keeps everything; an archived class takes no new lessons).",
			inputSchema: {
				class_id: z.string(),
				name: z.string().min(1).optional(),
				description: z.string().optional(),
				signature: SIGNATURE_ARG,
				icon: ICON_ARG.optional(),
				archived: z.boolean().optional(),
			},
		},
		async ({ class_id, name, description, signature, icon, archived }) => {
			const sig = signature ? cleanSignature(signature) : undefined;
			if (sig === null) return failure(`A signature is one line of at most ${SIGNATURE_MAX} characters.`);
			const outcome = updateClass(class_id, { name, description, archived, ...(icon ? { icon } : {}), ...(sig ? { signature: sig } : {}) });
			if (!outcome.ok) return failure(outcome.error);
			const cls = stores.classStore.getClass(class_id);
			const verb = archived === true ? "Archiving" : archived === false ? "Unarchiving" : "Updating";
			act({ label: `${verb} ${cls?.name ?? "a class"}`, classId: class_id, target: { kind: "class", id: class_id }, page: "/class" });
			return result({ class: classView(class_id) });
		},
	);

	server.registerTool(
		"add_class_file",
		{
			title: "Add a file to a class",
			description: "Copy a file from this computer into a class. Supported: .md .txt .pdf .vtt .srt (transcripts) and .mp3 .m4a .wav .mp4 .mov (recordings, transcribed locally with whisper.cpp). Study files are turned into facts in the background; check progress with read_class.",
			inputSchema: {
				class_id: z.string(),
				path: z.string().describe("The file's absolute path."),
				kind: FILE_KIND,
			},
		},
		async ({ class_id, path, kind }) => {
			const outcome = addFileFromPath(class_id, path, kind);
			if (!outcome.ok) return failure(outcome.error);
			act({ label: `Adding ${outcome.value.name}`, classId: class_id, target: { kind: "file", id: outcome.value.id }, page: "/class/files" });
			return result({ file: outcome.value, note: "Added. Check progress with read_class." });
		},
	);

	server.registerTool(
		"set_class_file_kind",
		{
			title: "Set a class file's kind",
			description: "Switch a class file between study material and course info. Study → info removes its facts; info → study builds them.",
			inputSchema: { class_id: z.string(), file_id: z.string(), kind: FILE_KIND },
		},
		async ({ class_id, file_id, kind }) => {
			const outcome = setFileKind(class_id, file_id, kind);
			if (!outcome.ok) return failure(outcome.error);
			act({ label: `Marking ${outcome.value.name} as ${kind === "study" ? "study material" : "course info"}`, classId: class_id, target: { kind: "file", id: file_id }, page: "/class/files" });
			return result({ file: outcome.value });
		},
	);

	server.registerTool(
		"add_class_deadline",
		{
			title: "Add a deadline to a class",
			description:
				"Add a deadline to a class: an exam, homework, quiz or project, with its date, its time if it has one, and which of the class's files (lecture notes, readings) it covers. godspeed uses this to show the learner what is due and what to work on first. Take the deadlines, their dates and times, and the covered lectures from the syllabus or course info; file ids come from read_class. If a date, a time or the covered files aren't clear, ask the learner instead of guessing.",
			inputSchema: {
				class_id: z.string(),
				kind: DEADLINE_KIND,
				name: z.string().min(1).describe('e.g. "Midterm 1", "Homework 5".'),
				date: z.string().describe("The due day as YYYY-MM-DD."),
				time: z.string().optional().describe('The due time as 24-hour "HH:MM" on this computer\'s clock. Leave it out when there is none (it then counts as due at the end of the day).'),
				file_ids: z.array(z.string()).optional().describe("Ids of the class files it covers (from read_class)."),
			},
		},
		async ({ class_id, kind, name, date, time, file_ids }) => {
			const outcome = addClassDeadline(class_id, { kind, name, date, ...(time !== undefined ? { time } : {}), ...(file_ids ? { fileIds: file_ids } : {}) });
			if (!outcome.ok) return failure(outcome.error);
			act({ label: `Adding ${outcome.value.name}`, classId: class_id, target: { kind: "deadline", id: outcome.value.id }, page: "/" });
			return result({ deadline: outcome.value });
		},
	);

	server.registerTool(
		"update_class_deadline",
		{
			title: "Update a class deadline",
			description:
				"Change a deadline's kind, name, date, time or covered files, or tick it done (done: true) or not done (done: false). file_ids replaces the whole list; time: null removes the time. Ask the learner instead of guessing when a change isn't clear.",
			inputSchema: {
				class_id: z.string(),
				deadline_id: z.string(),
				kind: DEADLINE_KIND.optional(),
				name: z.string().min(1).optional(),
				date: z.string().optional().describe("YYYY-MM-DD."),
				time: z.string().nullable().optional().describe('24-hour "HH:MM", or null to remove the time.'),
				file_ids: z.array(z.string()).optional(),
				done: z.boolean().optional(),
			},
		},
		async ({ class_id, deadline_id, kind, name, date, time, file_ids, done }) => {
			const outcome = updateClassDeadline(class_id, deadline_id, {
				...(kind !== undefined ? { kind } : {}),
				...(name !== undefined ? { name } : {}),
				...(date !== undefined ? { date } : {}),
				...(time !== undefined ? { time } : {}),
				...(file_ids !== undefined ? { fileIds: file_ids } : {}),
				...(done !== undefined ? { done } : {}),
			});
			if (!outcome.ok) return failure(outcome.error);
			const moved = (date !== undefined || time !== undefined) && kind === undefined && name === undefined && file_ids === undefined && done === undefined;
			const label = done === true ? `Marking ${outcome.value.name} done` : done === false ? `Marking ${outcome.value.name} not done` : `${moved ? "Moving" : "Changing"} ${outcome.value.name}`;
			act({ label, classId: class_id, target: { kind: "deadline", id: deadline_id }, page: "/" });
			return result({ deadline: outcome.value });
		},
	);

	server.registerTool(
		"remove_class_deadline",
		{
			title: "Remove a class deadline",
			description: "Remove one deadline from a class (its files and facts are not touched).",
			inputSchema: { class_id: z.string(), deadline_id: z.string() },
		},
		async ({ class_id, deadline_id }) => {
			const removedName = deadlineName(class_id, deadline_id);
			const outcome = removeClassDeadline(class_id, deadline_id);
			if (!outcome.ok) return failure(outcome.error);
			act({ label: `Removing ${removedName}`, classId: class_id, target: { kind: "deadline", id: deadline_id }, page: "/", removed: true });
			return result({ removed: deadline_id });
		},
	);

	server.registerTool(
		"link_class_folder",
		{
			title: "Link a folder to a class",
			description: "Link a folder on this computer to a class. Its supported files are added as study material, and from then on new files dropped there are added automatically and edited files are rebuilt (checked every minute while godspeed is open). godspeed never changes the folder. Use set_class_file_kind afterwards for course-info files.",
			inputSchema: { class_id: z.string(), path: z.string().describe("The folder's absolute path.") },
		},
		async ({ class_id, path }) => {
			const outcome = linkFolder(class_id, path);
			if (!outcome.ok) return failure(outcome.error);
			act({ label: `Linking ${folderName(path)}`, classId: class_id, target: { kind: "class", id: class_id }, page: "/class/files" });
			return result({ class: classView(class_id) });
		},
	);

	server.registerTool(
		"unlink_class_folder",
		{
			title: "Unlink a class's folder",
			description: "Unlink the class's folder: its files leave the class together with their facts. The folder itself is not touched.",
			inputSchema: { class_id: z.string() },
		},
		async ({ class_id }) => {
			const before = stores.classStore.getClass(class_id)?.linkedFolder;
			const outcome = unlinkFolder(class_id);
			if (!outcome.ok) return failure(outcome.error);
			act({ label: `Unlinking ${folderName(before)}`, classId: class_id, target: { kind: "class", id: class_id }, page: "/class/files" });
			return result({ class: classView(class_id) });
		},
	);
}

/** The MCP initialize request in the body, if any, with the client's name. */
async function initializeRequest(req: Request): Promise<{ name: string | undefined } | null> {
	try {
		const body: unknown = await req.clone().json();
		for (const message of Array.isArray(body) ? body : [body]) {
			const m = message as { method?: unknown; params?: { clientInfo?: { name?: unknown; title?: unknown } } } | null;
			if (m?.method === "initialize") return { name: displayAgentName(m.params?.clientInfo) };
		}
	} catch {
		/* not JSON: the transport reports it */
	}
	return null;
}

/** The /api/mcp transport: one stateless server per request. */
export async function handleMcpRequest(req: Request): Promise<Response> {
	const refused = refuse(req);
	if (refused) return refused;
	// Every authorized request is a check-in; initialize also names the agent.
	const init = req.method === "POST" ? await initializeRequest(req) : null;
	if (req.method === "POST") recordCheckIn(init?.name);
	// Only initialize hands instructions to the agent, so only it builds the briefing.
	const server = buildServer(init ? `${INSTRUCTIONS}\n\n${currentAgentBriefing()}` : INSTRUCTIONS);
	const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
	await server.connect(transport);
	try {
		return await transport.handleRequest(req);
	} finally {
		// JSON mode answers in one response; nothing stays open.
		void server.close();
	}
}
