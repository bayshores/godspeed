/**
 * layout-seed.mjs — the made-up data `npm run layout` walks, written by the real server.
 *
 * A small stand-in agent talks to the app over MCP, as Claude Code would: it makes the space
 * "Lab Algebra" with a deadline and one file, reads the file into one fact, starts a lesson and
 * answers it with a plan, then a sourced reply and an open quiz. Three homework deadlines get a homework lesson
 * each: one has its problems posted and a problem open at part (b), one has its problems posted and a
 * teaching reply with no problem open, and one has fourteen problems with the first done and none open.
 * Eight more lessons are studied (a plan of two steps, a quiz on the last one, answered) and two are
 * left open (a quiz on the first step, unanswered), so the Lessons block on Progress has both groups
 * and a Show all. Their titles are of mixed length, one very long.
 * A second space, "Backend jobs",
 * has a path toward a goal and nothing else. The window installs the plugin
 * "Flashcards", marked as from the made-up plugin list (tests/fixtures/plugins/layout-list.json)
 * at an older tag, so its sheet shows Update. No model runs; every word is fixed here.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** The made-up plugin that shows in a lesson and in a space, installed from this folder. */
const PLUGIN_FOLDER = path.resolve(import.meta.dirname, "..", "tests", "fixtures", "plugins", "layout");

const WEB_SOURCE = "[[https://example.com/lab-algebra/linear-equations]]";
/** Every made-up name has letters that hang below the line (g, j, p, q, y), so the check for
 *  cut-off letters has something to catch. */
const DEADLINE = "Pop quiz: graphing";
/** Three homework deadlines, each worked in its own lesson ("Work on <name>"). */
const HOMEWORK_OPEN = "Homework 3: graphing lines";
const HOMEWORK_FIRST = "Homework 4: solving equations";
const HOMEWORK_MANY = "Homework 5: graphing systems";
/** More problems than a row names, numbered as an assignment might ("2a"). */
const MANY_NUMBERS = ["1", "2a", "2b", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"];

/** Lessons the Lessons block lists besides the first lesson and the homework ones. */
const STUDIED_TOPICS = [
	"Slope",
	"Intercepts of a line",
	"Solving two-step equations",
	"Graphing systems of equations",
	"Parallel and perpendicular lines",
	"Word problems with one unknown, the kind that hides the equation in a story about trains",
	"Absolute value",
	"Reading a graph",
];
const OPEN_TOPICS = ["Inequalities on a number line", "Slope-intercept form, with every kind of mistake people make while plotting by hand and reading the result back"];

const HOMEWORK_PROBLEMS = {
	[HOMEWORK_OPEN]: [
		{ number: "1", title: "Solve two equations", text: "Solve each equation.\n\n(a) $2x + 3 = 11$\n\n(b) $\\frac{x}{3} - 4 = 2$", page: 1 },
		{ number: "2", title: "Graph a line", text: "Graph $y = 2x + 3$ and mark where it crosses the axes.", page: 2 },
	],
	[HOMEWORK_FIRST]: [
		{ number: "1", title: "Undo each step", text: "Solve $5x - 7 = 18$ and say what you undid first.", page: 1 },
		{ number: "2", title: "Check by graphing", text: "Graph $y = 5x - 7$ and $y = 18$ and read off the crossing.", page: 1 },
	],
	[HOMEWORK_MANY]: MANY_NUMBERS.map((number) => ({ number, title: `Graph system ${number}`, text: `Graph the pair of lines in system ${number} and say where they cross.`, page: 1 })),
};

/** The stand-in agent: tool calls to the app's MCP endpoint, each logged when sent and answered. */
function standIn(dataDir, log) {
	const { url } = JSON.parse(fs.readFileSync(path.join(dataDir, "mcp-endpoint.json"), "utf8"));
	const token = fs.readFileSync(path.join(dataDir, "mcp-token"), "utf8").trim();
	let id = 0;
	const rpc = async (method, params) => {
		const res = await fetch(url, {
			method: "POST",
			headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
		});
		if (!res.ok) throw new Error(`${method}: the app answered ${res.status}`);
		const body = await res.json();
		if (body.error) throw new Error(`${method}: ${body.error.message}`);
		return body.result;
	};
	/** A tool's text blocks; `json` parses the first. */
	const call = async (name, args) => {
		log(`agent sends ${name}`);
		const result = await rpc("tools/call", { name, arguments: args });
		const text = (result.content ?? []).filter((block) => block.type === "text").map((block) => block.text);
		log(`agent got ${name}: ${(text[0] ?? "").slice(0, 80)}`);
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

/** The homework lessons' replies; a tool that does not end the turn is followed by a turn with its
 *  result. The first lesson posts its problems and opens problem 1; after the learner says which
 *  part they start, it marks part (b) and says so. The second posts its problems, then teaches the
 *  method first, with no problem open. */
function homeworkAnswer(work, ids, lessonTurn) {
	if (work.lessonId === ids.homeworkOpen) {
		if (lessonTurn === 0) {
			return {
				tool_calls: [
					{ name: "post_problems", arguments: { problems: HOMEWORK_PROBLEMS[HOMEWORK_OPEN] } },
					{ name: "problem", arguments: { number: "1", statement: HOMEWORK_PROBLEMS[HOMEWORK_OPEN][0].text } },
				],
			};
		}
		if (lessonTurn === 1) return { tool_calls: [{ name: "part", arguments: { part: "b" } }] };
		return { text: "Part (b) it is. Undo the subtraction first." };
	}
	if (work.lessonId === ids.homeworkFirst) {
		if (lessonTurn === 0) return { tool_calls: [{ name: "post_problems", arguments: { problems: HOMEWORK_PROBLEMS[HOMEWORK_FIRST] } }] };
		return { text: "Before problem 1, here is the method. To solve $3x + 4 = 19$, undo each step in reverse: subtract 4 from both sides to get $3x = 15$, then divide both sides by 3 to get $x = 5$." };
	}
	// Posts its problems and opens the first; after the learner's answer, closes it solved.
	if (work.lessonId === ids.homeworkMany) {
		if (lessonTurn === 0) {
			return {
				tool_calls: [
					{ name: "post_problems", arguments: { problems: HOMEWORK_PROBLEMS[HOMEWORK_MANY] } },
					{ name: "problem", arguments: { number: "1", statement: HOMEWORK_PROBLEMS[HOMEWORK_MANY][0].text } },
				],
			};
		}
		if (lessonTurn === 1) return { tool_calls: [{ name: "conclude", arguments: { outcome: "solved", verdict: "Both lines cross at (2, 7), as you found." } }] };
		return { text: "That's the crossing. Pick any problem next." };
	}
	return null;
}

/** The two-step lessons: turn 0 writes the plan, turn 1 quizzes a step (the last for a studied
 *  lesson, the first for an open one), and turn 2, after the learner answered, is a closing line. */
function shortLessonAnswer(lessonTurn, studied) {
	if (lessonTurn === 0) return { text: "Here is the plan.", tool_calls: [{ name: "plan_init", arguments: { mermaid: "graph TD\n  first-step[First step] --> last-step[Last step]" } }] };
	if (lessonTurn === 1) {
		const options = [{ label: "4", value: "4" }, { label: "7", value: "7" }];
		const quiz = { type: "check", nodeId: studied ? "last-step" : "first-step", question: "What is x when x + 3 = 7?", options, explanation: "Subtract 3 from both sides.", correctAnswer: "4" };
		return { text: "Try this one.", tool_calls: [{ name: "quiz", arguments: quiz }] };
	}
	return { text: "That is right." };
}

/** The stand-in's answer to a work item, or null for one it does not expect. The lesson's first
 *  turn presents the plan; its second, after the plan's result, is the sourced reply with an open
 *  quiz, so the reply ends the reading pane. */
function answerFor(work, ids, lessonTurn) {
	const homework = homeworkAnswer(work, ids, lessonTurn);
	if (homework) return homework;
	if (ids.studied.includes(work.lessonId)) return shortLessonAnswer(lessonTurn, true);
	if (ids.open.includes(work.lessonId)) return shortLessonAnswer(lessonTurn, false);
	if (work.task?.startsWith("Graph extraction")) {
		return { tool_calls: [{ name: "submit_findings", arguments: { propositions: [{ id: "p1", name: "Undo in reverse", statement: "To solve ax + b = c, subtract b from both sides, then divide by a." }], chains: [], reteaches: [] } }] };
	}
	if (work.lessonId === ids.lesson && lessonTurn === 0) {
		return {
			text: "Here is the plan.",
			tool_calls: [{ name: "plan_init", arguments: { mermaid: "graph TD\n  read-equation[Read the equation] --> undo-adding[Undo adding] --> undo-multiplying[Undo multiplying] --> check-by-graphing[Check by graphing] --> word-problems[Word problems]" } }],
		};
	}
	if (work.lessonId === ids.lesson && lessonTurn === 1) {
		return {
			text: `To solve 2x + 3 = 11, undo each step in reverse: subtract 3 from both sides, then divide by 2. [[${ids.passage}]] Graphing y = 2x + 3 shows the same answer. ${WEB_SOURCE}`,
			tool_calls: [
				{
					name: "quiz",
					arguments: {
						type: "predict",
						nodeId: "undo-adding",
						question: "What is x when 2x + 3 = 11?",
						options: [{ label: "4", value: "4" }, { label: "7", value: "7" }, { label: "5.5", value: "5.5" }],
						explanation: "Subtract 3 to get 2x = 8, then divide by 2.",
						correctAnswer: "4",
					},
				},
			],
		};
	}
	// godspeed's own check of the space, a background job: it links the file to the deadline.
	if (work.task?.startsWith("Check: ")) {
		return { text: "Linked the graphing notes to the quiz.", tool_calls: [{ name: "update_space_deadline", arguments: { space_id: ids.space, deadline_id: ids.deadline, file_ids: [ids.passage.split(":")[0]] } }] };
	}
	// godspeed's own request to work out what a deadline covers, a background job.
	if (work.task?.startsWith("Deadline: ")) {
		return { text: `${DEADLINE} covers solving linear equations by graphing and by moving terms across the equals sign.` };
	}
	return null;
}

/**
 * Writes the made-up data into the running app. `page.fetch(path, init)` runs fetch in the
 * window, as the page itself would, and answers the status. `log` keeps a line per step. Answers the ids the
 * screens' addresses use.
 */
export async function seed(dataDir, page, log) {
	const agent = standIn(dataDir, log);
	await agent.init();
	const date = inDays(3);
	const { space } = await agent.json("create_space", {
		name: "Lab Algebra",
		description: "A made-up algebra space for the layout check.",
		signature: { kind: "math", value: "ax + b = c" },
		icon: "sigma",
	});
	await agent.call("add_space_deadline", {
		space_id: space.id,
		deadlines: [
			{ kind: "exam", name: DEADLINE, date, time: "10:00" },
			{ kind: "homework", name: HOMEWORK_OPEN, date: inDays(10) },
			{ kind: "homework", name: HOMEWORK_FIRST, date: inDays(11) },
			{ kind: "homework", name: HOMEWORK_MANY, date: inDays(12) },
		],
	});
	await agent.call("add_space_file", { space_id: space.id, kind: "study", name: "Graphing quiz prep.md", text: "# Solving by graphing\n\nTo solve ax + b = c, subtract b from both sides, then divide by a. Graphing y = ax + b and y = c gives the same x where the lines cross." });
	const { lessonId } = await agent.json("start_lesson", { topic: "Solving linear equations by graphing", space_id: space.id });
	await page.fetch("/api/plugins", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: "folder", folder: PLUGIN_FOLDER }) });
	fs.writeFileSync(path.join(dataDir, "plugins", "flashcards", ".source.json"), JSON.stringify({ repo: "example/flashcards", tag: "v1.0.0" }));

	// The file's passage, found and read as an agent would before citing it.
	let passage;
	for (let tries = 0; !passage; tries++) {
		if (tries > 30) throw new Error("the made-up file was never indexed for search");
		passage = /f_[0-9a-f]{12}:\d+/.exec((await agent.call("search_space_files", { space_id: space.id, query: "graphing" })).join("\n"))?.[0];
		if (!passage) await new Promise((done) => setTimeout(done, 300));
	}
	await agent.call("read_passage", { space_id: space.id, passage_id: passage });

	// Each homework deadline gets a lesson, as Work on does, and the window's own Continue wakes the teacher.
	const { deadlines: all } = await agent.json("read_space", { space_id: space.id });
	const deadlineNamed = (name) => all.find((d) => d.name === name).id;
	const homeworkLesson = async (name) => {
		await page.fetch("/api/chats", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ homework: true, spaceId: space.id, deadlineId: deadlineNamed(name) }) });
		const { lessons } = await agent.json("list_lessons", { space_id: space.id });
		const id = lessons.find((lesson) => lesson.title === `Work on ${name}`).id;
		await page.fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId: id, input: { type: "continue" } }) });
		return id;
	};
	const homeworkOpen = await homeworkLesson(HOMEWORK_OPEN);
	const homeworkFirst = await homeworkLesson(HOMEWORK_FIRST);
	const homeworkMany = await homeworkLesson(HOMEWORK_MANY);
	const startLesson = async (topic) => (await agent.json("start_lesson", { topic, space_id: space.id })).lessonId;
	const studied = [];
	for (const topic of STUDIED_TOPICS) studied.push(await startLesson(topic));
	const open = [];
	for (const topic of OPEN_TOPICS) open.push(await startLesson(topic));

	// Answer every item until the queue stays empty for two teacher and two helper waits in a row. A respond answers with the
	// next item when one waits. godspeed's own jobs (the space check) go to a helper, so an empty
	// wait hands over to the other kind; a wait that brought work asks as the same kind again, so
	// a row of lessons never sits behind a helper's empty wait.
	let helper = false;
	const wait = () => agent.call("wait_for_work", { timeout_seconds: 3, ...(helper ? { helper: true } : {}) });
	const turns = new Map();
	const ids = { lesson: lessonId, passage, space: space.id, deadline: deadlineNamed(DEADLINE), homeworkOpen, homeworkFirst, homeworkMany, studied, open };
	const drain = async () => {
		let reply = await wait();
		for (let idle = 0, tries = 0; idle < 4; tries++) {
			// Each added lesson is two items, and an item is two passes: the work, then its "turn done".
			if (tries > 20 + 4 * (studied.length + open.length)) throw new Error("the stand-in agent never ran out of work");
			const header = JSON.parse(reply[0]);
			if (header.status !== "work") {
				if (header.status === "idle") helper = !helper;
				idle++;
				reply = await wait();
				continue;
			}
			idle = 0;
			const texts = [...reply];
			for (let n = 2; n <= (header.pages ?? 1); n++) texts.push(...(await agent.call("read_work", { work_id: header.workId, page: n })));
			const work = workOf(texts.slice(header.pages > 1 ? 1 : 0).join(""));
			const turn = turns.get(work.lessonId) ?? 0;
			const answer = answerFor(work, ids, turn);
			if (work.lessonId) turns.set(work.lessonId, turn + 1);
			if (!answer) throw new Error(`the stand-in agent got work it does not expect: ${work.task ?? work.lessonId}`);
			reply = await agent.call("respond", { work_id: header.workId, ...answer, wait_seconds: 0 });
		}
	};
	await drain();
	// The learner says which part they start; the teacher marks it.
	await page.fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId: homeworkOpen, input: { type: "text", text: "I am starting part (b)." } }) });
	await page.fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId: homeworkMany, input: { type: "text", text: "They cross at (2, 7)." } }) });
	// The learner answers each studied lesson's quiz right, and the teacher closes the lesson.
	for (const chatId of studied) {
		const { messages } = await page.json(`/api/chats/${chatId}`);
		const quiz = messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).findLast((block) => block.type === "toolCall" && block.name === "quiz");
		const answer = { kind: "quiz", tool: "quiz", questionText: "What is x when x + 3 = 7?", dontKnow: false, answers: [{ label: "4", value: "4", index: 1 }], correct: true, answeredAt: new Date().toISOString() };
		await page.fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId, input: { type: "answer", toolCallId: quiz.id, answer } }) });
	}
	await drain();
	const covers = (topic) => `Enough ${topic} to get a junior job by spring, with typing practice daily.`;
	const steps = ["Git and pull requests", "HTTP and APIs", "SQL querying", "Typing in Python", "Caching layers", "Deploying apps", "Logging and paging", "Security group policy"];
	const goal = await agent.json("create_space", { name: "Backend jobs", icon: "code", path: { goal: "backend developer jobs", topics: steps.map((name) => ({ name, covers: covers(name) })) } });
	return { space: space.id, lesson: lessonId, deadline: ids.deadline, homeworkOpen, homeworkFirst, homeworkMany, homeworkOpenDeadline: deadlineNamed(HOMEWORK_OPEN), homeworkFirstDeadline: deadlineNamed(HOMEWORK_FIRST), homeworkManyDeadline: deadlineNamed(HOMEWORK_MANY), pathSpace: goal.space.id };
}
