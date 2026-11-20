/**
 * layout-seed.mjs — the made-up data `npm run layout` walks, written by the real server.
 *
 * A small stand-in agent talks to the app over MCP, as Claude Code would: it makes the space
 * "Lab Algebra" with a deadline and one file, reads the file into one fact, starts a lesson and
 * answers it with a plan, then a sourced reply and an open quiz. Four homework deadlines get a homework lesson
 * each: one has its problems posted and a problem open at part (b), one has its problems posted and a
 * teaching reply with no problem open, one has fourteen problems with the first done and none open, and
 * one has a printed worksheet as its assignment, with a problem open as the piece of its pages, at part (b).
 * Eight more lessons are studied (a plan of two steps, a quiz on the last one, answered) and two are
 * left open (a quiz on the first step, unanswered), so the Lessons block on Progress has both groups
 * and a Show all. One more poses a practice problem longer than the window, still open. Their titles are of mixed length, one very long. One more lesson is made and
 * never sent: the window sends its first message, whose reply waits for an agent.
 * Four more deadlines, far off, carry the cheat sheet and mock pages: the midterm has a sheet of two
 * pages with its chat and one saved rule, and a graded mock followed by a ready one; the quiz has a
 * sheet with two versions and a paused mock; the review quiz has a mock being taken against the
 * clock; the spring exam has nothing, so a screen can ask for a sheet and a mock with no agent to
 * answer. The sheet and the mocks are made the way the window makes them, and the stand-in agent
 * answers each request (a sheet's PDF is copied into the sheet's working folder, as an agent's own
 * tools would write it). A second space, "Backend jobs",
 * has a path toward a goal and nothing else. The window installs the plugin
 * "Flashcards", marked as from the made-up plugin list (tests/fixtures/plugins/layout-list.json)
 * at an older tag, so its sheet shows Update. No model runs; every word is fixed here.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** The made-up plugin that shows in a lesson and in a space, installed from this folder. */
const PLUGIN_FOLDER = path.resolve(import.meta.dirname, "..", "tests", "fixtures", "plugins", "layout");

const FIXTURES = path.resolve(import.meta.dirname, "..", "tests", "fixtures");

const WEB_SOURCE = "[[https://example.com/lab-algebra/linear-equations]]";
/** Every made-up name has letters that hang below the line (g, j, p, q, y), so the check for
 *  cut-off letters has something to catch. */
const DEADLINE = "Pop quiz: graphing";
/** Three homework deadlines, each worked in its own lesson ("Work on <name>"). */
const HOMEWORK_OPEN = "Homework 3: graphing lines";
const HOMEWORK_FIRST = "Homework 4: solving equations";
const HOMEWORK_MANY = "Homework 5: graphing systems";
/** A homework whose assignment is a printed worksheet: its problems show as pieces of its pages. */
const HOMEWORK_PRINTED = "Homework 6: a printed worksheet";
const WORKSHEET = path.resolve(import.meta.dirname, "..", "crates", "pdf", "tests", "fixtures", "worksheet.pdf");
/** The worksheet's problems, pointed at by their first words; the second runs onto page 2. */
const PRINTED_PROBLEMS = [
	{ number: "1", title: "Flipping a coin", source: { page: 1, starts: "1. First problem" } },
	{ number: "2", title: "A queue of lists", source: { page: 1, starts: "2. Second problem" } },
	{ number: "3", title: "Counting handshakes", source: { page: 2, starts: "3. Third problem" } },
];
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
/** The lesson whose first reply waits for an agent; its address sends it (layout-screens.mjs). */
export const WAITING_TOPIC = "Graphing two lines to find where they cross";
/** A lesson whose question is answered in words, so "Your turn" holds a three-line box. */
const WRITTEN_TOPIC = "Why undo in reverse";
const WRITTEN_REPLY = {
	text: "An equation is a balance: whatever you do to one side, you do to the other, so it stays true.\n\nTo solve 3x - 5 = 10, look at what was done to x: first it was multiplied by 3, then 5 was taken away. Undo those in reverse. Add 5 to both sides to get 3x = 15, then divide both sides by 3 to get x = 5.",
	tool_calls: [{ name: "ask_user_question", arguments: { question: "In your own words, why do we undo the steps in reverse order?" } }],
};
const OPEN_TOPICS = ["Inequalities on a number line", "Slope-intercept form, with every kind of mistake people make while plotting by hand and reading the result back"];
/** A lesson whose open practice problem is one part longer than the window. */
const LONG_PROBLEM_TOPIC = "Equations from a story";
const LONG_PROBLEM = [
	"Two trains leave stations 300 miles apart at noon and run toward each other on the same line. The first runs at a steady $x$ miles an hour. The second runs 15 miles an hour faster than the first, but it stops for half an hour at a town halfway along before it goes on at the same speed.",
	"A dispatcher sees them pass each other at a quarter to three. She writes one equation for the distance the first train covers, one for the second, and sets their sum equal to the distance between the stations:",
	"$$x \\cdot 2.75 + (x + 15)(2.75 - 0.5) = 300$$",
	"Say what each piece of her equation stands for, in words, and why the second train's time is shorter than the first train's. Then solve for $x$, and give both trains' speeds.",
	"Last, check your answer: put both speeds back into the story and work out how far each train has gone when they pass. Do the two distances add up to 300 miles? If they do not, find the step where the equation and the story stopped agreeing, and fix it.",
].join("\n\n");

/** Deadlines for the cheat sheet and mock pages, far off so Home stays as it was. */
const MIDTERM = "Midterm: graphing and systems";
const QUIZ = "Quiz 2: slopes and intercepts";
const REVIEW_QUIZ = "Review quiz: equations by graphing";
const SPRING_EXAM = "Spring exam: everything so far";

const SHEET_ASKS = {
	[MIDTERM]: "Make my cheat sheet for the midterm. Solving equations first, then graphing, and no more than two pages.",
	[QUIZ]: "Make me a cheat sheet for quiz 2.",
	short: "Make it fit on one page.",
};
const SHEET_REPLIES = {
	[MIDTERM]: {
		text: "I made your cheat sheet, two pages as you asked. Page 1 has the steps for solving an equation, lines and intercepts, and the mistakes to avoid. Page 2 has graphing a line, systems of two lines and word problems. The steps for solving come from your notes. [[PASSAGE]]",
		new_rules: ["Two pages, letter size"],
	},
	[QUIZ]: { text: "Here is your cheat sheet. It has two pages: solving, then graphing." },
	short: { text: "I cut it to one page by dropping the word problems and shortening the mistakes." },
};

const MOCK_QUESTIONS = [
	{
		title: "Why undo in reverse",
		kind: "text",
		statement: "In your own words, explain why we undo the steps of $2x + 3 = 11$ in reverse order. Then solve it and check your answer.",
	},
	{
		title: "Solve ax + b = c",
		kind: "code",
		statement: "Write `solveLinear(a, b, c)` that returns the $x$ that solves $ax + b = c$. Here $a$ is never 0, and every number is a whole number.",
		function_name: "solveLinear",
		params: ["a", "b", "c"],
		examples: [{ args: "[2, 3, 11]", expected: "4" }, { args: "[5, -7, 18]", expected: "5" }, { args: "[1, 0, 0]", expected: "0" }],
	},
	{
		title: "Where two lines cross",
		kind: "text",
		statement: "The lines $y = 2x + 3$ and $y = -x + 9$ cross at one point.\n\nFind the point, and say how you could see from the graph alone that there is no second crossing.",
	},
];
const MOCK_CODE = "function solveLinear(a, b, c) {\n\treturn (c - b) / a;\n}";
const MOCK_GRADES = [
	{ question: "q1", verdict: "right", feedback: "You said that adding 3 came last, so it is undone first, and you checked $x = 4$ in the equation. That is the whole idea." },
	{ question: "q2", verdict: "partly", feedback: "The formula is right, but it returns a decimal when $c - b$ is not a multiple of $a$, for example `solveLinear(2, 1, 4)`. Say what your function should do then, or round on purpose." },
];

const HOMEWORK_PROBLEMS = {
	[HOMEWORK_OPEN]: [
		{
			number: "1",
			title: "Solve three equations",
			text: "Solve each equation.\n\n(a) $2x + 3 = 11$, then put your answer back into the equation and say why both sides now agree\n\n(b) $\\frac{x}{3} - 4 = 2$\n\n(c) Solve for $x$ and graph both sides as lines:\n\n$$5 - 2x = -7$$",
			page: 1,
		},
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
 *  JSON starts with these fields, so they are read off the text. `text` is the whole item. */
export function workOf(text) {
	const field = (name) => new RegExp(`"${name}":"([^"\\\\]+)"`).exec(text)?.[1];
	return { lessonId: field("lessonId"), task: field("task"), text };
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
	// Posts the worksheet's problems by where they are printed and opens the second; after the
	// learner says which part they start, marks part (b).
	if (work.lessonId === ids.homeworkPrinted) {
		if (lessonTurn === 0) return { tool_calls: [{ name: "post_problems", arguments: { problems: PRINTED_PROBLEMS } }, { name: "problem", arguments: { number: "2" } }] };
		if (lessonTurn === 1) return { tool_calls: [{ name: "part", arguments: { part: "b" } }] };
		return { text: "Part (b) it is. What does the loop change each time around?" };
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

/** The answer to a cheat sheet request. The PDF is copied into the sheet's working folder, which
 *  the request names, as an agent's own tools would write it there. The request is JSON text, so
 *  the folder's line ends at an escaped newline. */
function sheetAnswer(work, ids) {
	const asked = work.text.split("The learner says:").pop();
	const key = asked.includes(SHEET_ASKS.short) ? "short" : work.task.includes(MIDTERM) ? MIDTERM : QUIZ;
	const folder = /Working folder: ([^"\\]+)\\n/.exec(work.text)?.[1];
	if (!folder) throw new Error("the cheat sheet request does not name its working folder");
	fs.copyFileSync(path.join(FIXTURES, key === "short" ? "layout-sheet-one-page.pdf" : "layout-sheet-two-pages.pdf"), path.join(folder, "sheet.pdf"));
	const reply = SHEET_REPLIES[key];
	return { tool_calls: [{ name: "sheet_reply", arguments: { ...reply, text: reply.text.replace("PASSAGE", ids.passage), pdf_path: "sheet.pdf" } }] };
}

/** The stand-in's answer to a work item, or null for one it does not expect. The lesson's first
 *  turn presents the plan; its second, after the plan's result, is the sourced reply with an open
 *  quiz, so the reply ends the reading pane. */
function answerFor(work, ids, lessonTurn) {
	const homework = homeworkAnswer(work, ids, lessonTurn);
	if (homework) return homework;
	if (work.lessonId === ids.written) return WRITTEN_REPLY;
	// The lesson is made last, so until then no id is here to match work that has no lesson.
	if (ids.sheetless && work.lessonId === ids.sheetless) return { text: "A pull request asks to merge one branch into another." };
	if (ids.studied.includes(work.lessonId)) return shortLessonAnswer(lessonTurn, true);
	if (ids.open.includes(work.lessonId)) return shortLessonAnswer(lessonTurn, false);
	if (work.lessonId === ids.longProblem) {
		if (lessonTurn === 0) return shortLessonAnswer(0, false);
		if (lessonTurn === 1) {
			const problem = { nodeId: "first-step", statement: LONG_PROBLEM, mode: "composition", modelSolution: "2.75x + 2.25(x + 15) = 300, so 5x = 266.25 and x = 53.25: 53.25 and 68.25 miles an hour." };
			return { text: "Try this one.", tool_calls: [{ name: "problem", arguments: problem }] };
		}
	}
	if (work.task?.startsWith("Cheat sheet: ")) return sheetAnswer(work, ids);
	if (/^Mock \d+: questions$/.test(work.task ?? "")) return { tool_calls: [{ name: "write_mock_questions", arguments: { questions: MOCK_QUESTIONS } }] };
	if (/^Mock \d+: grading$/.test(work.task ?? "")) return { tool_calls: [{ name: "grade_mock", arguments: { grades: MOCK_GRADES } }] };
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
			{ kind: "homework", name: HOMEWORK_PRINTED, date: inDays(13) },
			{ kind: "exam", name: MIDTERM, date: inDays(30), time: "09:00" },
			{ kind: "quiz", name: QUIZ, date: inDays(32) },
			{ kind: "quiz", name: REVIEW_QUIZ, date: inDays(34) },
			{ kind: "exam", name: SPRING_EXAM, date: inDays(36) },
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
	// The homework with a problem open has the made-up file as its assignment, so "Your turn" names it.
	await agent.call("update_space_deadline", { space_id: space.id, deadline_id: deadlineNamed(HOMEWORK_OPEN), assignment_file_id: passage.split(":")[0] });
	// A mock is written from a deadline's study facts or its "what it's like" file. The facts come
	// from a graph run the check starts later, so the four deadlines have the file.
	await agent.call("add_space_file", { space_id: space.id, kind: "info", name: "What the quizzes are like.md", text: "# What the quizzes are like\n\nShort written answers, a few lines of code, and one graph to read. Calculators are not allowed." });
	const aboutId = (await agent.json("read_space", { space_id: space.id, files: true })).files.find((file) => file.name === "What the quizzes are like.md").id;
	for (const name of [MIDTERM, QUIZ, REVIEW_QUIZ, SPRING_EXAM]) await agent.call("update_space_deadline", { space_id: space.id, deadline_id: deadlineNamed(name), about_file_id: aboutId });
	const worksheet = (await agent.json("add_space_file", { space_id: space.id, kind: "info", path: WORKSHEET })).file;
	await agent.call("update_space_deadline", { space_id: space.id, deadline_id: deadlineNamed(HOMEWORK_PRINTED), assignment_file_id: worksheet.id });
	const homeworkOpen = await homeworkLesson(HOMEWORK_OPEN);
	const homeworkPrinted = await homeworkLesson(HOMEWORK_PRINTED);
	const homeworkFirst = await homeworkLesson(HOMEWORK_FIRST);
	const homeworkMany = await homeworkLesson(HOMEWORK_MANY);
	const written = (await agent.json("start_lesson", { topic: WRITTEN_TOPIC, space_id: space.id })).lessonId;
	const startLesson = async (topic) => (await agent.json("start_lesson", { topic, space_id: space.id })).lessonId;
	const studied = [];
	for (const topic of STUDIED_TOPICS) studied.push(await startLesson(topic));
	const open = [];
	for (const topic of OPEN_TOPICS) open.push(await startLesson(topic));
	const longProblem = await startLesson(LONG_PROBLEM_TOPIC);

	// Answer every item until the queue stays empty for two teacher and two helper waits in a row. A respond answers with the
	// next item when one waits. godspeed's own jobs (the space check) go to a helper, so an empty
	// wait hands over to the other kind; a wait that brought work asks as the same kind again, so
	// a row of lessons never sits behind a helper's empty wait.
	let helper = false;
	const wait = () => agent.call("wait_for_work", { timeout_seconds: 3, ...(helper ? { helper: true } : {}) });
	const turns = new Map();
	const ids = { lesson: lessonId, passage, space: space.id, deadline: deadlineNamed(DEADLINE), homeworkOpen, homeworkFirst, homeworkMany, homeworkPrinted, studied, open, written, longProblem };
	const drain = async () => {
		let reply = await wait();
		for (let idle = 0, tries = 0; idle < 4; tries++) {
			// Each added lesson is two items, and an item is two passes: the work, then its "turn done".
			if (tries > 20 + 4 * (studied.length + open.length + 2)) throw new Error("the stand-in agent never ran out of work");
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
	await page.fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId: homeworkPrinted, input: { type: "text", text: "I am starting part (b)." } }) });
	// The learner answers each studied lesson's quiz right, and the teacher closes the lesson.
	for (const chatId of studied) {
		const { messages } = await page.json(`/api/chats/${chatId}`);
		const quiz = messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).findLast((block) => block.type === "toolCall" && block.name === "quiz");
		const answer = { kind: "quiz", tool: "quiz", questionText: "What is x when x + 3 = 7?", dontKnow: false, answers: [{ label: "4", value: "4", index: 1 }], correct: true, answeredAt: new Date().toISOString() };
		await page.fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId, input: { type: "answer", toolCallId: quiz.id, answer } }) });
	}
	await drain();
	const send = (url, body) => page.fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
	const midterm = deadlineNamed(MIDTERM);
	const quiz = deadlineNamed(QUIZ);
	const reviewQuiz = deadlineNamed(REVIEW_QUIZ);
	const sheetOf = (deadlineId) => `/api/spaces/${space.id}/deadlines/${deadlineId}/cheat-sheet`;
	const mockOf = async (deadlineId, n) => (await page.json(`/api/spaces/${space.id}/mocks?deadline=${deadlineId}`)).mocks.find((mock) => mock.n === n).id;
	const mockAction = (mockId, body) => send(`/api/spaces/${space.id}/mocks/${mockId}`, body);
	// The learner asks for the first sheets and mocks; each request is answered by the stand-in agent.
	await send(sheetOf(midterm), { action: "ask", text: SHEET_ASKS[MIDTERM] });
	await send(sheetOf(quiz), { action: "ask", text: SHEET_ASKS[QUIZ] });
	await send(`/api/spaces/${space.id}/mocks`, { deadlineId: midterm, questions: 3, minutes: 30 });
	await send(`/api/spaces/${space.id}/mocks`, { deadlineId: quiz, questions: 3, minutes: 90 });
	await send(`/api/spaces/${space.id}/mocks`, { deadlineId: reviewQuiz, questions: 3, minutes: 240 });
	await drain();
	// The quiz's sheet is changed once, so it has two versions.
	await send(sheetOf(quiz), { action: "ask", text: SHEET_ASKS.short });
	// The midterm's mock is taken (paused once), ended with one question left blank, and graded.
	const graded = await mockOf(midterm, 1);
	await mockAction(graded, { action: "start" });
	await mockAction(graded, { action: "pause" });
	await mockAction(graded, { action: "resume" });
	await mockAction(graded, { action: "answer", questionId: "q1", text: "Adding 3 happened last, so it comes off first. 2x = 8, so x = 4, and 2 times 4 plus 3 is 11.", seconds: 240, submitted: true });
	await mockAction(graded, { action: "answer", questionId: "q2", text: "", language: "javascript", code: { javascript: MOCK_CODE }, seconds: 410, submitted: true });
	await mockAction(graded, { action: "end" });
	// The quiz's mock is paused, and the review quiz's is under way with its first answer saved.
	const paused = await mockOf(quiz, 1);
	await mockAction(paused, { action: "start" });
	await mockAction(paused, { action: "pause" });
	const running = await mockOf(reviewQuiz, 1);
	await mockAction(running, { action: "start" });
	await mockAction(running, { action: "answer", questionId: "q1", text: "Adding 3 happened last, so", seconds: 50, submitted: false });
	await drain();
	// The midterm's next mock is made once the last one is graded; it waits to be started.
	await send(`/api/spaces/${space.id}/mocks`, { deadlineId: midterm, questions: 3 });
	await drain();
	const ready = await mockOf(midterm, 2);
	// A lesson made as the window's Study does, whose first message the window sends when it opens: its reply waits for an agent.
	await page.fetch("/api/chats", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: WAITING_TOPIC, spaceId: space.id }) });
	const pending = (await agent.json("list_lessons", { space_id: space.id })).lessons.find((lesson) => lesson.title === WAITING_TOPIC).id;
	const covers = (topic) => `Enough ${topic} to get a junior job by spring, with typing practice daily.`;
	const steps = ["Git and pull requests", "HTTP and APIs", "SQL querying", "Typing in Python", "Caching layers", "Deploying apps", "Logging and paging", "Security group policy"];
	const goal = await agent.json("create_space", { name: "Backend jobs", icon: "code", path: { goal: "backend developer jobs", topics: steps.map((name) => ({ name, covers: covers(name) })) } });
	// A lesson in the space with no deadline: its cheat sheet column has no sheet to show.
	const sheetless = (await agent.json("start_lesson", { topic: "Git and pull requests", space_id: goal.space.id })).lessonId;
	ids.sheetless = sheetless;
	await drain();
	return { sheetless, space: space.id, sheetMade: midterm, sheetVersions: quiz, mockRunDeadline: reviewQuiz, waitingDeadline: deadlineNamed(SPRING_EXAM), mockGraded: graded, mockReady: ready, mockRunning: running, mockPaused: paused, lesson: lessonId, written, longProblem, pending, deadline: ids.deadline, homeworkOpen, homeworkFirst, homeworkMany, homeworkPrinted, homeworkOpenDeadline: deadlineNamed(HOMEWORK_OPEN), homeworkFirstDeadline: deadlineNamed(HOMEWORK_FIRST), homeworkManyDeadline: deadlineNamed(HOMEWORK_MANY), homeworkPrintedDeadline: deadlineNamed(HOMEWORK_PRINTED), pathSpace: goal.space.id };
}
