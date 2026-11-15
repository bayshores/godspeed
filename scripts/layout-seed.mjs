/**
 * layout-seed.mjs — the made-up data `npm run layout` walks, written by the real server.
 *
 * A small stand-in agent talks to the app over MCP, as Claude Code would: it makes the space
 * "Lab Algebra" with a deadline and one file, reads the file into one fact, starts a lesson and
 * answers it with a plan, then a sourced reply and an open quiz, and answers a Talk message with
 * a sourced reply. No model runs; every word is fixed here.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const SOURCE = "[[https://example.com/lab-algebra/linear-equations]]";

/** The stand-in agent: tool calls to the app's MCP endpoint. */
function standIn(dataDir) {
	const { url } = JSON.parse(fs.readFileSync(path.join(dataDir, "mcp-endpoint.json"), "utf8"));
	const token = fs.readFileSync(path.join(dataDir, "mcp-token"), "utf8").trim();
	let id = 0;
	const rpc = async (method, params) => {
		const res = await fetch(url, {
			method: "POST",
			headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
		});
		const body = await res.json();
		if (body.error) throw new Error(`${method}: ${body.error.message}`);
		return body.result;
	};
	/** A tool's text blocks; `json` parses the first. */
	const call = async (name, args) => {
		const result = await rpc("tools/call", { name, arguments: args });
		const text = (result.content ?? []).filter((block) => block.type === "text").map((block) => block.text);
		if (result.isError) throw new Error(`${name}: ${text.join(" ")}`);
		return text;
	};
	const json = async (name, args) => JSON.parse((await call(name, args))[0]);
	return { init: () => rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "layout-stand-in", version: "1" } }), call, json };
}

/** What a work item is for. A long item comes in pages and its first page is cut text, but its
 *  JSON starts with these fields, so they are read off the text. */
export function workOf(text) {
	const field = (name) => new RegExp(`"${name}":"([^"\\\\]+)"`).exec(text)?.[1];
	return { lessonId: field("lessonId"), task: field("task") };
}

/** The day `days` from now on this computer's calendar, as YYYY-MM-DD. */
function inDays(days) {
	const day = new Date(Date.now() + days * 86_400_000);
	return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

/** The stand-in's answer to a work item, or null for one it does not expect. The lesson's first
 *  turn presents the plan; its second, after the plan's result, is the sourced reply with an open
 *  quiz, so the reply ends the reading pane. */
function answerFor(work, ids, date, lessonTurn) {
	if (work.task?.startsWith("Graph extraction")) {
		return { tool_calls: [{ name: "submit_findings", arguments: { propositions: [{ id: "p1", name: "Undo in reverse", statement: "To solve ax + b = c, subtract b from both sides, then divide by a." }], chains: [], reteaches: [] } }] };
	}
	if (work.lessonId === ids.lesson && lessonTurn === 0) {
		return {
			text: "Here is the plan.",
			tool_calls: [{ name: "plan_init", arguments: { mermaid: "graph TD\n  read-equation[Read the equation] --> undo-addition[Undo addition] --> undo-multiplication[Undo multiplication] --> check-answer[Check the answer] --> word-problems[Word problems]" } }],
		};
	}
	if (work.lessonId === ids.lesson && lessonTurn === 1) {
		return {
			text: `To solve 2x + 3 = 11, undo each step in reverse: subtract 3 from both sides, then divide by 2. ${SOURCE}`,
			tool_calls: [
				{
					name: "quiz",
					arguments: {
						type: "predict",
						nodeId: "undo-addition",
						question: "What is x when 2x + 3 = 11?",
						options: [{ label: "4", value: "4" }, { label: "7", value: "7" }, { label: "5.5", value: "5.5" }],
						explanation: "Subtract 3 to get 2x = 8, then divide by 2.",
						correctAnswer: "4",
					},
				},
			],
		};
	}
	if (work.lessonId === "chat_talk") {
		return { text: `Midterm 1 is on ${date} at 10:00. It covers linear equations: moving terms across the equals sign and dividing by the coefficient. ${SOURCE}\n\nStart with the lesson on solving linear equations; it has a short quiz.` };
	}
	return null;
}

/**
 * Writes the made-up data into the running app. `page.fetch(path, init)` runs fetch in the
 * window, as the page itself would, and answers the status; `page.start` only starts it.
 * Answers the ids the screens' addresses use.
 */
export async function seed(dataDir, page) {
	const agent = standIn(dataDir);
	await agent.init();
	const date = inDays(3);
	const { space } = await agent.json("create_space", {
		name: "Lab Algebra",
		description: "A made-up algebra space for the layout check.",
		signature: { kind: "math", value: "ax + b = c" },
		icon: "sigma",
	});
	await agent.call("add_space_deadline", { space_id: space.id, deadlines: [{ kind: "exam", name: "Midterm 1", date, time: "10:00" }] });
	await agent.call("add_space_file", { space_id: space.id, kind: "study", name: "Week 1 notes.md", text: "# Linear equations\n\nTo solve ax + b = c, subtract b from both sides, then divide by a." });
	const { lessonId } = await agent.json("start_lesson", { topic: "Solving linear equations", space_id: space.id });
	await page.fetch("/api/talk", { method: "POST" });
	// The Talk turn's request stays open until the stand-in answers it.
	await page.start("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId: "chat_talk", input: { type: "text", text: "When is my midterm, and what does it cover?" } }) });

	// Answer every item until the queue stays empty twice in a row. A respond answers with the
	// next item when one waits.
	let reply = await agent.call("wait_for_work", { timeout_seconds: 3 });
	let lessonTurns = 0;
	for (let idle = 0, tries = 0; idle < 2; tries++) {
		if (tries > 20) throw new Error("the stand-in agent never ran out of work");
		const header = JSON.parse(reply[0]);
		if (header.status !== "work") {
			idle++;
			reply = await agent.call("wait_for_work", { timeout_seconds: 3 });
			continue;
		}
		idle = 0;
		const texts = [...reply];
		for (let n = 2; n <= (header.pages ?? 1); n++) texts.push(...(await agent.call("read_work", { work_id: header.workId, page: n })));
		const work = workOf(texts.slice(header.pages > 1 ? 1 : 0).join(""));
		const answer = answerFor(work, { lesson: lessonId }, date, lessonTurns);
		if (work.lessonId === lessonId) lessonTurns++;
		if (!answer) throw new Error(`the stand-in agent got work it does not expect: ${work.task ?? work.lessonId}`);
		reply = await agent.call("respond", { work_id: header.workId, ...answer, wait_seconds: 0 });
	}
	const { deadlines } = await agent.json("read_space", { space_id: space.id });
	return { space: space.id, lesson: lessonId, deadline: deadlines[0].id };
}
