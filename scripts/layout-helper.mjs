/**
 * layout-helper.mjs — the stand-in for godspeed's Claude helper that `npm run layout` starts
 * instead (LH_CLAUDE_HELPER, a debug build only). It speaks the helper's JSON lines
 * (crates/runtime/src/claude/protocol.rs) and plays the made-up lessons of layout-lessons.mjs
 * through godspeed's real lesson tools, so no agent runs and every word is fixed.
 *
 * A session's first message says which lesson it is; each message after it is the next turn of
 * that lesson. A turn plays the lesson's next replies: its text, then its tool calls one at a
 * time, each waiting for godspeed's answer. The turn ends when a tool ends it (a question for the
 * learner), when a reply calls no tool, or when the lesson has no reply left. Which reply each
 * lesson is at is kept in LAYOUT_HELPER_DIR, since the app is started twice and resumes its
 * sessions. A lesson that holds never ends its turn until it is stopped; the word a screen writes
 * to the `desk` file in that folder makes it read files as an agent at work would (`read`), ask
 * to run a command (`approve`), or write a reply's first sentence and go back to reading under it
 * (`stream`).
 *
 * A session that is not kept is one of godspeed's background jobs: its one turn plays the fixed
 * answer layout-jobs.mjs gives for the job's tools and request.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { jobAnswer } from "./layout-jobs.mjs";
import { LESSONS, PLAN_ORDER_SENT_BACK } from "./layout-lessons.mjs";

const DIR = process.env.LAYOUT_HELPER_DIR;
const STATE = DIR && path.join(DIR, "state.json");
const DESK = DIR && path.join(DIR, "desk");
const PASSAGE = /f_[0-9a-f]{12}:\d+/;
/** The passage the seed found, which lessons cite. */
const CITED = DIR && path.join(DIR, "passage");

/** Where each session's lesson stands: native id -> { lesson (an index of LESSONS), next reply }. */
const stands = STATE && fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {};
const save = () => STATE && fs.writeFileSync(STATE, JSON.stringify(stands));

const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const log = (line) => process.stderr.write(`[layout helper] ${line}\n`);
const sdk = (session, message) => write({ type: "sdk", session, message: { ...message, parent_tool_use_id: null } });

const sessions = new Map();
/** Calls waiting for godspeed's answer, by id. */
const waiting = new Map();
let nextId = 1;

/** `value` with {passage} filled in wherever a string holds it. */
function filled(value, passage) {
	if (typeof value === "string") return value.replaceAll("{passage}", passage ?? "");
	if (Array.isArray(value)) return value.map((item) => filled(item, passage));
	if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, filled(item, passage)]));
	return value;
}

/** A tool call with the id godspeed will know it by. */
const newCall = (name, args) => ({ id: String(nextId++), name, arguments: args });

/** Sends one call and waits for godspeed's answer; a stop answers `stopped`. */
function callTool(session, call) {
	write({ type: "tool_call", id: call.id, session: session.key, toolUseId: `toolu_${call.id}`, name: call.name, args: call.arguments });
	return new Promise((done) => {
		waiting.set(call.id, (answer) => {
			session.cancel = null;
			done(answer);
		});
		session.cancel = () => {
			waiting.delete(call.id);
			session.cancel = null;
			done({ stopped: true });
		};
	});
}

/** Sends the assistant message of one step: text, then the tool uses that follow it. */
function assistant(session, text, calls) {
	if (text) {
		for (const word of text.split(/(?<= )/)) sdk(session.key, { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: word } } });
	}
	const content = [...(text ? [{ type: "text", text }] : []), ...calls.map((call) => ({ type: "tool_use", id: `toolu_${call.id}`, name: `mcp__godspeed__${call.name}`, input: call.arguments }))];
	if (content.length > 0) sdk(session.key, { type: "assistant", message: { content } });
}

/** One of the agent's own tools, started and done. */
function ownTool(session, name, input) {
	const id = `toolu_own_${nextId++}`;
	sdk(session.key, { type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
	sdk(session.key, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id }] } });
}

const textOf = (answer) => (answer.content ?? []).map((part) => part.text ?? "").join("\n");

/** Plays one reply. Answers "ended" when a tool ended the turn, "stopped" when the turn was stopped,
 *  "went on" when the turn goes on to the next reply, and "done" when it ends with this one. */
async function playReply(session, reply) {
	const calls = (reply.tool_calls ?? []).map((call) => newCall(call.name, filled(call.arguments, session.passage)));
	assistant(session, filled(reply.text ?? "", session.passage), calls);
	if (calls.length === 0) return "done";
	for (const call of calls) {
		let answer = await callTool(session, call);
		// A card tagged past a plan step the lesson never asked comes back once; the same card sent
		// again goes through.
		if (!answer.stopped && textOf(answer).includes(PLAN_ORDER_SENT_BACK)) {
			const again = newCall(call.name, call.arguments);
			assistant(session, "", [again]);
			answer = await callTool(session, again);
		}
		if (answer.stopped) return "stopped";
		if (answer.endTurn) return "ended";
	}
	return "went on";
}

/** Reads a file of its own, then a passage of the space's, as an agent at work would. */
async function readFiles(session) {
	ownTool(session, "Read", { file_path: "notes.md" });
	const found = await callTool(session, newCall("search_space_files", { query: "graphing" }));
	const passage = found.stopped ? null : PASSAGE.exec(textOf(found))?.[0];
	if (passage) await callTool(session, newCall("read_passage", { passage_id: passage }));
}

/** Asks to run a command, and leaves the card on the desk until the learner answers it. */
function askApproval(session) {
	if (session.approval && waiting.has(session.approval)) return;
	const id = `approval_${nextId++}`;
	const toolUseId = `toolu_own_${nextId++}`;
	const input = { command: "ls notes" };
	session.approval = id;
	sdk(session.key, { type: "assistant", message: { content: [{ type: "tool_use", id: toolUseId, name: "Bash", input }] } });
	waiting.set(id, (answer) => {
		if (answer.allow) sdk(session.key, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: toolUseId }] } });
	});
	write({ type: "approval", id, session: session.key, tool: "Bash", input, toolUseId });
}

const FIRST_SENTENCE = "To solve an equation, undo what was done to x in the opposite order.";

/** Writes a reply's first sentence word by word, once, then reads a file of its own: a step after
 *  the words, so the page shows a reply half written with the desk back under it. */
async function writeThenRead(session) {
	if (session.wrote) return;
	session.wrote = true;
	for (const word of FIRST_SENTENCE.split(/(?<= )/)) {
		sdk(session.key, { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: word } } });
		await new Promise((done) => setTimeout(done, 60));
	}
	sdk(session.key, { type: "assistant", message: { content: [{ type: "text", text: FIRST_SENTENCE }] } });
	ownTool(session, "Read", { file_path: "notes.md" });
}

/** The requests a screen can make of a held turn, by the word it writes to the desk file. */
const DESK_REQUESTS = { read: readFiles, approve: askApproval, stream: writeThenRead };

/** Holds the turn until it is stopped, doing what the desk file asks while it waits. */
async function hold(session) {
	while (!session.stopped) {
		if (DESK && fs.existsSync(DESK)) {
			await DESK_REQUESTS[fs.readFileSync(DESK, "utf8").trim()]?.(session);
			fs.rmSync(DESK, { force: true });
		}
		await new Promise((done) => setTimeout(done, 100));
	}
}

function finish(session, stopped) {
	if (session.closed) return;
	sdk(session.key, stopped ? { type: "result", subtype: "error_during_execution", is_error: true, errors: [] } : { type: "result", subtype: "success", is_error: false });
}

/** The passage the seed found. A job can start before the seed has written it, so it waits. */
async function citedPassage(session) {
	for (let tries = 0; CITED && !fs.existsSync(CITED) && tries < 600 && !session.stopped; tries++) await new Promise((done) => setTimeout(done, 100));
	return CITED && fs.existsSync(CITED) ? fs.readFileSync(CITED, "utf8").trim() : null;
}

/** One model call's tokens, as Claude Code streams them, so the job's run keeps what it took
 *  (Activity's graph costs read it). */
function modelCall(session) {
	sdk(session.key, { type: "stream_event", event: { type: "message_start", message: { usage: { input_tokens: 1200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } } });
	sdk(session.key, { type: "stream_event", event: { type: "message_delta", usage: { output_tokens: 300 } } });
}

/** A job's turn: its answer, once. A follow-up turn, or a job no answer fits, ends with no reply. */
async function playJob(session, texts) {
	session.passage = await citedPassage(session);
	const answer = session.answered ? null : jobAnswer({ tools: session.job.tools, text: texts.join("\n"), cwd: session.job.cwd }, session.passage);
	if (!session.answered && !answer) log(`no job answer for ${JSON.stringify(texts.join("\n").slice(0, 80))}`);
	session.answered = true;
	if (answer?.holds) {
		while (!session.stopped) await new Promise((done) => setTimeout(done, 100));
		return finish(session, true);
	}
	if (answer) modelCall(session);
	const how = answer ? await playReply(session, answer) : "done";
	return finish(session, how === "stopped");
}

/** The turn a message starts: the lesson's next replies. */
async function playTurn(session, texts) {
	session.stopped = false;
	sdk(session.key, { type: "system", subtype: "init" });
	if (session.job) return playJob(session, texts);
	session.passage = CITED && fs.existsSync(CITED) ? fs.readFileSync(CITED, "utf8").trim() : null;
	if (!session.lesson) {
		const at = LESSONS.findIndex((lesson) => lesson.is(texts));
		if (at < 0) log(`no lesson starts with ${JSON.stringify(texts.map((text) => text.slice(0, 60)))}`);
		else session.lesson = { at, next: 0 };
	}
	const lesson = session.lesson && LESSONS[session.lesson.at];
	if (lesson?.holds) {
		await hold(session);
		return finish(session, true);
	}
	for (;;) {
		const reply = lesson?.replies[session.lesson.next];
		if (!reply) return finish(session, false);
		stands[session.native] = { ...session.lesson, next: ++session.lesson.next };
		save();
		const how = await playReply(session, reply);
		if (how === "stopped") return finish(session, true);
		if (how !== "went on") return finish(session, false);
	}
}

function open(message) {
	const { session: key, resume } = message;
	const native = resume ?? randomUUID();
	const job = message.persist === false ? { tools: (message.tools ?? []).map((tool) => tool.name), cwd: message.cwd } : null;
	const session = { key, native, job, lesson: stands[native] ? { ...stands[native] } : null, passage: null, cancel: null, stopped: false, closed: false, turns: Promise.resolve() };
	sessions.set(key, session);
	write({ type: "opened", session: key, nativeId: native });
}

function take(message) {
	if (message.type === "open") return open(message);
	if (message.type === "tool_result" || message.type === "approval") {
		const done = waiting.get(message.id);
		waiting.delete(message.id);
		return done?.(message);
	}
	const session = sessions.get(message.session);
	if (!session) return write({ type: "error", session: message.session ?? null, message: `no open session ${message.session}` });
	switch (message.type) {
		case "send": {
			const texts = (message.content ?? []).filter((part) => part.type === "text").map((part) => part.text);
			session.turns = session.turns.then(() => playTurn(session, texts));
			return;
		}
		case "interrupt":
			session.stopped = true;
			return session.cancel?.();
		case "close":
			session.closed = true;
			session.stopped = true;
			session.cancel?.();
			sessions.delete(message.session);
			return write({ type: "closed", session: message.session });
	}
}

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
	if (line.trim()) take(JSON.parse(line));
});
lines.on("close", () => process.exit(0));
