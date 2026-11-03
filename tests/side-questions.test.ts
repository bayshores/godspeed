/**
 * Side questions: while a question waits, the learner asks the teacher
 * something else. The question stays open around the side question and
 * its reply, the model sees a placeholder result at the call and the real
 * answer later where it happened, and a side turn can't pose a question.
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
	newUserMessage,
	parseChatInput,
	phaseTimeline,
	projectView,
	SIDE_ANSWER_LEAD,
	SIDE_PENDING_TEXT,
	teachStepIndex,
	toLlmMessages,
} = await import("../src/core/index.ts");
type LhMessage = import("../src/core/index.ts").LhMessage;
const { createTeacherAgent } = await import("../src/agent/teacher-agent.ts");
const { handleChatInput } = await import("../src/server/chat-handler.ts");
const { runningTurn } = await import("../src/server/turn-runs.ts");
const { deliverJobResult, discardChatDeliveries, setTurnRunner } = await import("../src/server/jobs.ts");
const { buildSubagentSteer } = await import("../src/core/contracts.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { jobStore } = await import("../src/store/jobs.ts");
await (await import("../src/agent/engine-load.ts")).loadAgentCore();

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
