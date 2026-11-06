/**
 * Side questions: while a question waits, the learner asks the teacher
 * something else. The question stays open around the side question and
 * its reply, the model sees a placeholder result at the call and the real
 * answer later where it happened, and a side turn can't pose a question.
 * The same holds around an active practice problem: it stays active, the
 * model reads the side question as one, and a side turn can't pose or
 * conclude a problem.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

// Every store write goes to a throwaway data folder (set before any app import).
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-side-questions-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } = await import("@earendil-works/pi-ai");
const {
	activeProblemOf,
	ChatInputError,
	danglingQuestionOf,
	dismissedAnswer,
	findPendingToolCall,
	inputAppends,
	isSideTurn,
	needsContinuation,
	newAnswerResult,
	newCompactionMarker,
	newPlanBlockMessage,
	newSideQuestion,
	newThinkingMessage,
	newUserMessage,
	parseChatInput,
	pdfNote,
	pdfNoteOf,
	phaseTimeline,
	projectView,
	SIDE_ANSWER_LEAD,
	SIDE_PENDING_TEXT,
	SIDE_PROBLEM_LEAD,
	teachStepIndex,
	toLlmMessages,
} = await import("../../src/shared/core/index.ts");
type LhMessage = import("../../src/shared/core/index.ts").LhMessage;
const { createPracticeAgent, createStudyAgent, createTeacherAgent } = await import("../../src/backend/agent/teacher-agent.ts");
const { practiceOutcomes } = await import("../../src/shared/core/practice-outcomes.ts");
const { handleChatInput } = await import("../../src/backend/server/chat-handler.ts");
const { runningTurn } = await import("../../src/backend/server/turn-runs.ts");
const { deliverJobResult, discardChatDeliveries, setTurnRunner } = await import("../../src/backend/server/jobs.ts");
const { buildSubagentSteer } = await import("../../src/shared/core/contracts.ts");
const { chatStore } = await import("../../src/backend/store/chats.ts");
const { jobStore } = await import("../../src/backend/store/jobs.ts");
await (await import("../../src/backend/agent/engine-load.ts")).loadAgentCore();

after(() => fs.rmSync(TMP_DATA, { recursive: true, force: true }));

const QUIZ = { question: "Which planet is closest to the sun?", options: [{ label: "Venus" }, { label: "Mercury" }], correctAnswer: "Mercury", explanation: "Innermost.", type: "check", nodeId: "planets" };

function assistant(id: string, content: unknown[]): LhMessage {
	return { id, role: "assistant", content, stopReason: "toolUse", api: "faux", provider: "faux", model: "m", usage: {}, timestamp: 0 } as unknown as LhMessage;
}
const quizCall = (id: string, callIds: string[]) => assistant(id, callIds.map((c) => ({ type: "toolCall", id: c, name: "quiz", arguments: QUIZ })));
const reply = (id: string, text: string) => assistant(id, [{ type: "text", text }]);
const answer = (callId: string) => newAnswerResult(callId, "quiz", { kind: "quiz", correct: true, answers: [{ index: 1, label: "Mercury" }] });

describe("the open question survives side questions (danglingQuestionOf)", () => {
	const start = [newUserMessage("teach me planets"), quizCall("a1", ["q1"])];

	it("stays open through any number of side questions and replies", () => {
		const record = [...start, newSideQuestion("why Mercury?"), reply("a2", "Because."), newSideQuestion("and Venus?"), reply("a3", "Second.")];
		assert.equal(danglingQuestionOf(record)?.toolCallId, "q1");
		assert.equal(danglingQuestionOf([...start, newSideQuestion("why?")])?.toolCallId, "q1", "before the reply too");
	});

	it("a reply with its own tool steps, a plan block or a compaction marker keeps it open", () => {
		const read = assistant("a2", [{ type: "toolCall", id: "r1", name: "read", arguments: {} }]);
		const readResult = { ...newAnswerResult("r1", "read", {}), toolName: "read" } as LhMessage;
		const marker = newCompactionMarker("summary", { firstKeptMessageId: "x", tokensBefore: 1, at: "2026-01-01T00:00:00Z" }) as LhMessage;
		const block = newPlanBlockMessage("p1", {}) as LhMessage;
		const record = [...start, block, marker, newSideQuestion("why?"), read, readResult, reply("a3", "Because.")];
		assert.equal(danglingQuestionOf(record)?.toolCallId, "q1");
	});

	it("closes once answered, and a plain message never holds it open", () => {
		assert.equal(danglingQuestionOf([...start, newSideQuestion("why?"), reply("a2", "Because."), answer("q1")]), null);
		assert.equal(danglingQuestionOf([...start, newUserMessage("hi"), reply("a2", "Hello.")]), null);
	});

	it("parallel questions: the sibling still waiting is the open one", () => {
		const record = [newUserMessage("go"), quizCall("a1", ["q1", "q2"]), answer("q1"), newSideQuestion("why?"), reply("a2", "Because.")];
		assert.equal(danglingQuestionOf(record)?.toolCallId, "q2");
	});

	it("the client's view finds the same question across the side rows", () => {
		const record = [...start, newSideQuestion("why?"), reply("a2", "Because.")];
		assert.equal(findPendingToolCall(projectView(record))?.toolCallId, "q1");
	});

	it("a plain message interrupts it, for the server and the client alike", () => {
		const sent = [...start, newUserMessage("hi")];
		assert.equal(danglingQuestionOf(sent), null, "before the reply");
		assert.equal(findPendingToolCall(projectView(sent)), null);
		assert.equal(findPendingToolCall(projectView([...sent, reply("a2", "Hello.")])), null, "after the reply");
	});
});

describe("the lesson view after side questions (projectView)", () => {
	const teach = assistant("a1", [{ type: "text", text: "Mercury is first." }, { type: "toolCall", id: "q1", name: "quiz", arguments: QUIZ }]);
	const asked = [newUserMessage("teach me planets"), teach, newSideQuestion("why?"), reply("a2", "Because.")];
	const kinds = (view: ReturnType<typeof projectView>) => view.map((m) => m.parts.filter((p) => p.type !== "step-start").map((p) => p.type).join(","));

	it("the answered card shows where the answer happened, above the teacher's reaction", () => {
		const view = projectView([...asked, answer("q1"), reply("a3", "Right.")]);
		assert.deepEqual(kinds(view), ["text", "text,tool-quiz", "text", "text,tool-quiz,text"]);
		assert.equal(view[1]!.parts.find((p) => p.type === "tool-quiz")!.state, "moved", "only a trace stays where it was asked");
		assert.equal(view[3]!.parts.find((p) => p.type === "tool-quiz")!.state, "output-available");
	});

	it("while it waits, the question stays in its own place (the panel shows it)", () => {
		const view = projectView(asked);
		assert.deepEqual(kinds(view), ["text", "text,tool-quiz", "text", "text"]);
	});

	it("the Teaching divider stays above the block that asked the first question", () => {
		const probeDone = assistant("p1", [{ type: "toolCall", id: "pd", name: "probe_done", arguments: {} }]);
		const probeResult = { ...newAnswerResult("pd", "probe_done", { ok: true }), toolName: "probe_done" } as LhMessage;
		const record = [newUserMessage("teach me planets"), probeDone, probeResult, newUserMessage("go ahead"), teach, newSideQuestion("why?"), reply("a2", "Because."), answer("q1"), reply("a3", "Right.")];
		const view = projectView(record);
		const teachAt = view.findIndex((m) => m.id === "a1");
		const phases = phaseTimeline(view);
		assert.equal(phases[teachAt - 1], "plan");
		assert.equal(phases[teachAt], "teach");
		assert.equal(teachStepIndex(view[teachAt]!.parts), -1, "the divider sits before the whole block");
	});
});

describe("what the model sees (toLlmMessages)", () => {
	const start = [newUserMessage("teach me planets"), quizCall("a1", ["q1"])];
	const asked = [...start, newSideQuestion("why Mercury?"), reply("a2", "Because.")];
	const textOf = (m: unknown) => ((m as { content: Array<{ text?: string }> }).content[0]?.text ?? "");

	it("a placeholder result right after the call, then the side question as a plain user message", () => {
		const out = toLlmMessages(asked);
		assert.deepEqual(out.map((m) => m.role), ["user", "assistant", "toolResult", "user", "assistant"]);
		assert.equal(textOf(out[2]), SIDE_PENDING_TEXT);
		assert.equal((out[2] as { toolCallId?: string }).toolCallId, "q1");
		assert.equal(out[3]!.content, "why Mercury?");
		assert.equal("side" in out[3]!, false, "the record field never reaches the wire");
	});

	it("the real answer arrives at its own place as the learner's message, and the earlier view stays a prefix", () => {
		const before = toLlmMessages(asked);
		const after = toLlmMessages([...asked, answer("q1")]);
		assert.deepEqual(after.slice(0, before.length), before);
		const last = after.at(-1)!;
		assert.equal(last.role, "user");
		assert.equal(textOf(last), SIDE_ANSWER_LEAD + JSON.stringify({ kind: "quiz", answers: [{ index: 1, label: "Mercury" }], correct: true }));
	});

	it("a skip after side questions arrives the same way", () => {
		const skipped = newAnswerResult("q1", "quiz", dismissedAnswer("quiz", QUIZ.question));
		assert.equal(textOf(toLlmMessages([...asked, skipped]).at(-1)), SIDE_ANSWER_LEAD + JSON.stringify({ kind: "quiz", dismissed: true }));
	});

	it("with parallel questions, each late answer names its question", () => {
		const second = { ...QUIZ, question: "Which planet is second?" };
		const both = assistant("a1", [
			{ type: "toolCall", id: "q1", name: "quiz", arguments: QUIZ },
			{ type: "toolCall", id: "q2", name: "quiz", arguments: second },
		]);
		const out = toLlmMessages([newUserMessage("go"), both, newSideQuestion("why?"), reply("a2", "Because."), answer("q1"), answer("q2")]);
		const [first, last] = out.slice(-2).map(textOf);
		assert.ok(first!.startsWith(`The learner answered your open question (${JSON.stringify(QUIZ.question)}): `));
		assert.ok(last!.startsWith(`The learner answered your open question (${JSON.stringify(second.question)}): `));
	});

	it("a side question's pictures and PDF notes reach the model with its text", () => {
		const picture = { type: "image" as const, data: "QUJD", mimeType: "image/png" };
		const pdf = pdfNote("notes.pdf", "/data/chats/c1/abc-notes.pdf");
		const out = toLlmMessages([...start, newSideQuestion("what about this?", [picture, pdf])]);
		assert.deepEqual(out.at(-1)!.content, [{ type: "text", text: "what about this?" }, picture, pdf]);
	});

	it("without side questions nothing changes: the answer is the call's tool result", () => {
		const out = toLlmMessages([...start, answer("q1")]);
		assert.deepEqual(out.map((m) => m.role), ["user", "assistant", "toolResult"]);
		assert.equal(textOf(out[2]), JSON.stringify({ kind: "quiz", answers: [{ index: 1, label: "Mercury" }], correct: true }));
	});
});

describe("the continuation fold after side questions (needsContinuation)", () => {
	const asked = [newUserMessage("go"), quizCall("a1", ["q1"]), newSideQuestion("why?"), reply("a2", "Because.")];

	it("an answer after side questions owes the reaction; a skip and the side reply itself owe nothing", () => {
		assert.equal(needsContinuation([...asked, answer("q1")]), true);
		assert.equal(needsContinuation([...asked, newAnswerResult("q1", "quiz", dismissedAnswer("quiz", QUIZ.question))]), false);
		assert.equal(needsContinuation(asked), false);
	});
});

describe("the side input", () => {
	const waiting = { messages: [newUserMessage("go"), quizCall("a1", ["q1"])] };

	it("parses text and refuses an empty one", () => {
		assert.deepEqual(parseChatInput({ type: "side", text: "why?" }), { type: "side", text: "why?" });
		assert.throws(() => parseChatInput({ type: "side", text: "  " }), ChatInputError);
	});

	it("takes files like the message box: alone or with text, within the same limits", () => {
		const file = { name: "graph.png", mimeType: "image/png", data: "iVBORw0KGgo=" };
		assert.deepEqual(parseChatInput({ type: "side", text: "", attachments: [file] }), { type: "side", text: "", attachments: [file] });
		assert.throws(() => parseChatInput({ type: "side", text: "why?", attachments: Array(6).fill(file) }), ChatInputError);
		assert.throws(() => parseChatInput({ type: "side", text: "why?", attachments: [{ ...file, name: "a.heic", mimeType: "image/heic" }] }), ChatInputError);
		const picture = { type: "image" as const, data: "QUJD", mimeType: "image/png" };
		const [m] = inputAppends(waiting, { type: "side", text: "", attachments: [file] }, [picture]);
		assert.equal((m as { side?: boolean }).side, true);
		assert.deepEqual(m!.content, [picture]);
	});

	it("appends a side question only while a question waits", () => {
		const [m] = inputAppends(waiting, { type: "side", text: "why?" });
		assert.equal(m!.role, "user");
		assert.equal((m as { side?: boolean }).side, true);
		assert.throws(() => inputAppends({ messages: [newUserMessage("go")] }, { type: "side", text: "why?" }), ChatInputError);
		assert.throws(() => inputAppends({ messages: [...waiting.messages, answer("q1")] }, { type: "side", text: "why?" }), ChatInputError);
	});
});

describe("which turn is a side turn (isSideTurn)", () => {
	const waiting = [newUserMessage("go"), quizCall("a1", ["q1"])];

	it("only a turn whose newest learner message is a side question, while the question is open", () => {
		assert.equal(isSideTurn([...waiting, newSideQuestion("why?")]), true);
		assert.equal(isSideTurn([...waiting, newSideQuestion("why?"), reply("a2", "Because."), newSideQuestion("and?")]), true);
		assert.equal(isSideTurn([...waiting, newUserMessage("hi")]), false, "a plain message while a question waits");
		assert.equal(isSideTurn([...waiting, newSideQuestion("why?"), reply("a2", "Because."), answer("q1")]), false, "the answer turn");
		assert.equal(isSideTurn(waiting), false);
	});
});

describe("a side turn can't pose a question", () => {
	it("keeps the same tool list, but the question tools refuse", async () => {
		const tools = (sideTurn: boolean) => createTeacherAgent(undefined, { sideTurn }).state.tools;
		assert.deepEqual(tools(true).map((t) => t.name), tools(false).map((t) => t.name), "an unchanged list keeps the agent's delta cheap");
		const quiz = tools(true).find((t) => t.name === "quiz")!;
		const result = await quiz.execute("call-x", {} as never);
		assert.equal(result.isError, true);
	});
});

describe("a side question through the chat handler", () => {
	/** The tool names a request declared (pi carries them on system messages). */
	function toolNames(messages: Array<{ role: string; toolsAdded?: { name: string }[]; toolsRemoved?: { name: string }[] }>): string[] {
		const names = new Set<string>();
		for (const m of messages) {
			if (m.role !== "system") continue;
			for (const t of m.toolsAdded ?? []) names.add(t.name);
			for (const t of m.toolsRemoved ?? []) names.delete(t.name);
		}
		return [...names].sort();
	}

	async function run(chatId: string, input: unknown, build: Parameters<typeof handleChatInput>[2]): Promise<Response> {
		const res = await handleChatInput(chatId, input as never, build);
		const handle = runningTurn(chatId);
		if (handle) await new Response(handle.subscribe()).text();
		return res;
	}

	it("the teacher replies without new questions, the question stays open, and the answer reaches the model in place", async () => {
		const seen: Array<{ roles: string[]; tools: string[]; last: string }> = [];
		const faux = createFauxCore({});
		const capture = (context: { messages: Array<{ role: string; content?: unknown }> }) => {
			const visible = context.messages.filter((m) => m.role !== "system");
			const last = visible.at(-1)!;
			seen.push({
				roles: visible.map((m) => m.role),
				tools: toolNames(context.messages as never),
				last: typeof last.content === "string" ? last.content : JSON.stringify(last.content),
			});
		};
		faux.setResponses([
			(context) => {
				capture(context as never);
				return fauxAssistantMessage([fauxToolCall("quiz", QUIZ, { id: "call-q" })], { stopReason: "toolUse" });
			},
			(context) => {
				capture(context as never);
				return fauxAssistantMessage([fauxText("Mercury orbits closest.")]);
			},
			(context) => {
				capture(context as never);
				return fauxAssistantMessage([fauxText("Right.")]);
			},
		]);
		const engine = { model: faux.getModel(), streamFn: faux.streamSimple };
		const build: Parameters<typeof handleChatInput>[2] = (opts) => createTeacherAgent(undefined, { engine, messages: opts.messages, sideTurn: opts.sideTurn });
		const chat = chatStore.createChat("side questions");

		assert.equal((await run(chat.id, { type: "side", text: "too early" }, build)).status, 400, "no question waits yet");
		await run(chat.id, { type: "text", text: "teach me planets" }, build);
		assert.equal(danglingQuestionOf(chatStore.getChat(chat.id)!.messages)?.toolCallId, "call-q");

		assert.equal((await run(chat.id, { type: "side", text: "why does it matter?" }, build)).status, 200);
		const afterSide = chatStore.getChat(chat.id)!.messages;
		assert.equal(danglingQuestionOf(afterSide)?.toolCallId, "call-q", "the question is still waiting");
		assert.equal(afterSide.at(-1)!.role, "assistant");
		assert.equal((afterSide.at(-1) as { stopReason?: string }).stopReason, "stop");
		assert.deepEqual(seen[1]!.tools, seen[0]!.tools, "the side turn keeps the same tools");
		assert.deepEqual(seen[1]!.roles.slice(-3), ["assistant", "toolResult", "user"]);
		assert.equal(seen[1]!.last, "why does it matter?");

		await run(chat.id, { type: "answer", toolCallId: "call-q", answer: { kind: "quiz", correct: true, answers: [{ index: 1, label: "Mercury" }] } }, build);
		assert.equal(danglingQuestionOf(chatStore.getChat(chat.id)!.messages), null);
		assert.equal(seen[2]!.roles.at(-1), "user");
		assert.ok(seen[2]!.last.includes(SIDE_ANSWER_LEAD), "the answer arrives as the learner's message");
	});

	it("a side question's PDF is saved beside the lesson and the teacher gets its path", async () => {
		const seen: unknown[] = [];
		const faux = createFauxCore({});
		faux.setResponses([
			() => fauxAssistantMessage([fauxToolCall("quiz", QUIZ, { id: "call-q" })], { stopReason: "toolUse" }),
			(context) => {
				seen.push((context as { messages: Array<{ content?: unknown }> }).messages.at(-1)!.content);
				return fauxAssistantMessage([fauxText("Page 2 says so.")]);
			},
		]);
		const engine = { model: faux.getModel(), streamFn: faux.streamSimple };
		const build: Parameters<typeof handleChatInput>[2] = (opts) => createTeacherAgent(undefined, { engine, messages: opts.messages, sideTurn: opts.sideTurn });
		const chat = chatStore.createChat("side question files");
		await run(chat.id, { type: "text", text: "teach me planets" }, build);
		const data = Buffer.from("%PDF-1.4\n%%EOF\n").toString("base64");
		const res = await run(chat.id, { type: "side", text: "see my notes", attachments: [{ name: "notes.pdf", mimeType: "application/pdf", data }] }, build);
		assert.equal(res.status, 200);
		const [text, note] = seen[0] as Array<{ type: string; text: string }>;
		assert.equal(text!.text, "see my notes");
		const saved = pdfNoteOf(note!.text);
		assert.equal(saved?.name, "notes.pdf");
		assert.ok(fs.existsSync(saved!.path), "the PDF is on disk at the path the teacher reads");
		assert.equal(danglingQuestionOf(chatStore.getChat(chat.id)!.messages)?.toolCallId, "call-q", "the question is still waiting");
	});

	it("a side turn takes no [Today] note and no job result, so nothing but the side reply follows the question", async () => {
		const faux = createFauxCore({});
		faux.setResponses([
			() => fauxAssistantMessage([fauxToolCall("quiz", QUIZ, { id: "call-q" })], { stopReason: "toolUse" }),
			() => fauxAssistantMessage([fauxText("Mercury orbits closest.")]),
		]);
		const engine = { model: faux.getModel(), streamFn: faux.streamSimple };
		const build: Parameters<typeof handleChatInput>[2] = (opts) => createTeacherAgent(undefined, { engine, messages: opts.messages, sideTurn: opts.sideTurn });
		// Any wake while the question waits would be a bug; keep it hermetic.
		let wakes = 0;
		setTurnRunner(async () => {
			wakes++;
			return 200;
		});
		const chat = chatStore.createChat("side questions: no note, no job");
		await run(chat.id, { type: "text", text: "teach me planets" }, build);
		// No note in view, as on a new day: a learner message would get one.
		const isNote = (m: LhMessage) => m.role === "custom" && m.customType === "today-context";
		chatStore.saveMessages(chat.id, chatStore.getChat(chat.id)!.messages.filter((m) => !isNote(m)));
		const job = jobStore.createJob({ kind: "research", chatId: chat.id, toolCallId: "call-r" });
		const steer = buildSubagentSteer(job, { brief: "A finished brief.", sources: [] });
		void deliverJobResult(steer);

		await run(chat.id, { type: "side", text: "why does it matter?" }, build);
		const messages = chatStore.getChat(chat.id)!.messages;
		const callAt = messages.findIndex((m) => m.role === "assistant" && m.content.some((b) => b.type === "toolCall" && b.id === "call-q"));
		assert.deepEqual(
			messages.slice(callAt + 1).map((m) => (m.role === "user" ? `user${(m as { side?: true }).side ? ":side" : ""}` : m.role)),
			["user:side", "assistant"],
			"no note and no job result after the waiting question",
		);
		assert.equal(danglingQuestionOf(messages)?.toolCallId, "call-q");
		assert.equal(wakes, 0);
		discardChatDeliveries(chat.id);
	});
});

// ─── around an active practice problem ──────────────────────────────────────

const POSE = { statement: "How many subsets does a 3-element set have?", mode: "recall", target: ["n_count"], modelSolution: "$2^3 = 8$." };
const CONCLUDE = { outcome: "solved", verdict: "Right.", rung: null, missClass: null, retest: false };
const call = (id: string, name: string, callId: string, args: unknown) => assistant(id, [{ type: "toolCall", id: callId, name, arguments: args }]);
const ack = (callId: string, toolName: string, isError = false) =>
	({ id: `r-${callId}`, role: "toolResult", toolCallId: callId, toolName, content: [{ type: "text", text: isError ? "refused" : "ok" }], details: null, isError, timestamp: 0 }) as unknown as LhMessage;

describe("a side question on a practice problem", () => {
	const posed = [newUserMessage("practice counting"), call("a1", "problem", "p1", POSE), ack("p1", "problem")];
	const picture = { type: "image" as const, data: "QUJD", mimeType: "image/png" };
	// The side reply tries to conclude (refused), then answers in text;
	// thinking follows and the teacher concludes.
	const full = [
		...posed,
		newSideQuestion("what's a subset?", [picture]),
		call("a2", "conclude", "c0", CONCLUDE),
		ack("c0", "conclude", true),
		reply("a3", "A set inside the set."),
		newThinkingMessage("p1", "2^3 = 8"),
		call("a4", "conclude", "c1", CONCLUDE),
		ack("c1", "conclude"),
		reply("a5", "Nice."),
	];

	it("is taken while a problem is active, and refused once it is concluded or discarded", () => {
		const [m] = inputAppends({ messages: posed }, { type: "side", text: "what's a subset?" });
		assert.equal((m as { side?: boolean }).side, true);
		assert.throws(() => inputAppends({ messages: full }, { type: "side", text: "why?" }), ChatInputError, "concluded");
		const dismissed = [...posed, { id: "d1", role: "custom", customType: "problem-dismissed", content: "", display: false, details: { problemCallId: "p1" }, timestamp: 0 } as LhMessage];
		assert.throws(() => inputAppends({ messages: dismissed }, { type: "side", text: "why?" }), ChatInputError, "discarded");
	});

	it("leaves the problem active through the side question and its reply, and thinking still targets it", () => {
		const replied = full.slice(0, posed.length + 4);
		assert.equal(activeProblemOf(replied)?.toolCallId, "p1");
		const [thinking] = inputAppends({ messages: replied }, { type: "thinking", problemCallId: "p1", text: "8" }).slice(-1) as Array<{ customType?: string }>;
		assert.equal(thinking!.customType, "practice-thinking");
		assert.equal(activeProblemOf(full), null, "the teacher's own conclude ends it");
	});

	it("counts the problem's outcome once: the refused conclude and the side question change nothing", () => {
		const outcomes = practiceOutcomes(full);
		assert.equal(outcomes.length, 1);
		assert.equal(outcomes[0]!.outcome, "solved");
		assert.equal(outcomes[0]!.problemCallId, "p1");
	});

	it("is a side turn only while its reply is owed: not after thinking, a job result or a conclude", () => {
		const asked = [...posed, newSideQuestion("why?")];
		assert.equal(isSideTurn(asked), true);
		assert.equal(isSideTurn([...asked, reply("a2", "Because."), newSideQuestion("and?")]), true);
		assert.equal(isSideTurn([...asked, reply("a2", "Because."), newThinkingMessage("p1", "8")]), false, "the thinking turn");
		const job = jobStore.createJob({ kind: "research", chatId: "c-side", toolCallId: "call-r" });
		assert.equal(isSideTurn([...asked, reply("a2", "Because."), buildSubagentSteer(job, { brief: "Done.", sources: [] }) as LhMessage]), false, "a job result's wake");
		assert.equal(isSideTurn([...asked, reply("a2", "Because."), call("a3", "conclude", "c1", CONCLUDE), ack("c1", "conclude")]), false);
	});

	it("reaches the model as a side question after the problem's own result, its picture with it, and every earlier view stays a prefix", () => {
		const views = [posed.length + 1, posed.length + 4, posed.length + 5, full.length].map((n) => toLlmMessages(full.slice(0, n) as never));
		for (let i = 1; i < views.length; i++) assert.deepEqual(views[i]!.slice(0, views[i - 1]!.length), views[i - 1], `view ${i - 1} is a prefix of view ${i}`);
		const wire = views.at(-1)!;
		assert.deepEqual(
			wire.map((m) => m.role),
			["user", "assistant", "toolResult", "user", "assistant", "toolResult", "assistant", "user", "assistant", "toolResult", "assistant"],
		);
		const side = wire[3]!.content as Array<{ type: string; text?: string }>;
		assert.equal(side[0]!.text, `${SIDE_PROBLEM_LEAD}what's a subset?`);
		assert.deepEqual(side[1], picture);
		assert.equal((wire[2] as { content: Array<{ text: string }> }).content[0]!.text, "ok", "the problem keeps its own result");
		assert.ok(!JSON.stringify(wire).includes(SIDE_PENDING_TEXT));
		assert.ok(!("side" in wire[3]!), "the record field never reaches the wire");
	});

	it("a picture alone gets the lead as its text", () => {
		const wire = toLlmMessages([...posed, newSideQuestion("", [picture])] as never);
		assert.deepEqual(wire.at(-1)!.content, [{ type: "text", text: SIDE_PROBLEM_LEAD.trimEnd() }, picture]);
	});

	it("practice and study side turns keep their tools, but problem and conclude refuse", async () => {
		const ctx = { chatId: "c-side", chatStore: { getChat: () => ({ messages: posed }) } };
		const practice = (sideTurn: boolean) => createPracticeAgent(ctx, { sideTurn }).state.tools;
		const study = (sideTurn: boolean) =>
			createStudyAgent({ ...ctx, jobStore, spawn: () => {} } as never, { sideTurn }).state.tools;
		for (const tools of [practice, study]) {
			assert.deepEqual(tools(true).map((t) => t.name), tools(false).map((t) => t.name));
			for (const name of ["problem", "conclude"]) {
				const result = await tools(true).find((t) => t.name === name)!.execute("call-x", (name === "problem" ? POSE : CONCLUDE) as never);
				assert.equal(result.isError, true, name);
				assert.match((result.content[0] as { text: string }).text, /side question/);
			}
		}
	});

	it("through the handler, an older practice session's side reply can't conclude and the problem stays", async () => {
		const faux = createFauxCore({});
		faux.setResponses([
			() => fauxAssistantMessage([fauxToolCall("problem", POSE, { id: "call-p" })], { stopReason: "toolUse" }),
			() => fauxAssistantMessage([fauxToolCall("conclude", CONCLUDE, { id: "call-c0" })], { stopReason: "toolUse" }),
			() => fauxAssistantMessage([fauxText("A set inside the set.")]),
		]);
		const engine = { model: faux.getModel(), streamFn: faux.streamSimple };
		const chat = chatStore.createChat("side question on a problem", "practice");
		const build: Parameters<typeof handleChatInput>[2] = (opts) => createPracticeAgent({ chatId: chat.id, chatStore }, { engine, messages: opts.messages, sideTurn: opts.sideTurn });
		const run = async (input: unknown) => {
			const res = await handleChatInput(chat.id, input as never, build);
			const handle = runningTurn(chat.id);
			if (handle) await new Response(handle.subscribe()).text();
			return res.status;
		};
		await run({ type: "text", text: "practice counting" });
		assert.equal(await run({ type: "side", text: "what's a subset?" }), 200);
		const messages = chatStore.getChat(chat.id)!.messages;
		assert.equal(activeProblemOf(messages)?.toolCallId, "call-p");
		const refusal = messages.find((m) => m.role === "toolResult" && m.toolCallId === "call-c0");
		assert.equal((refusal as { isError?: boolean }).isError, true);
		assert.equal(practiceOutcomes(messages).length, 0);
	});
});
