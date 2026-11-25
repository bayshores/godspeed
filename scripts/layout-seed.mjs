/**
 * layout-seed.mjs — the made-up data `npm run layout` walks, written by the real server.
 *
 * A small stand-in agent talks to the app over MCP, as Claude Code would: it makes the space
 * "Lab Algebra" with a deadline and one file, reads the file into ten facts that the stand-in sorts
 * into five linked topics, and starts the lessons. The lessons play on the stand-in helper
 * (layout-helper.mjs, the lessons in layout-lessons.mjs); the seed starts them, says what the
 * learner says to them and waits for their turns to end.
 * Four more deadlines, far off, carry the cheat sheet and mock pages: the midterm has a sheet of two
 * pages with its chat and one saved rule, and a graded mock followed by a ready one; the quiz has a
 * sheet with two versions and a paused mock; the review quiz has a mock being taken against the
 * clock; the spring exam has nothing, so a screen can ask for a sheet and a mock with no agent to
 * answer. The sheet and the mocks are made the way the window makes them, and the stand-in agent
 * answers each request (a sheet's PDF is copied into the sheet's working folder, as an agent's own
 * tools would write it). A second space, "Backend jobs",
 * has a path toward a goal and one file read into two facts, too few to sort into topics. The window installs the plugin
 * "Flashcards", marked as from the made-up plugin list (tests/fixtures/plugins/layout-list.json)
 * at an older tag, so its sheet shows Update. No model runs; every word is fixed here.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
	ASKED_FIRST,
	ASKED_FIRST_TOPIC,
	CODE_CHOICES_TOPIC,
	CONCLUDED_TOPIC,
	DISCARDED_TOPIC,
	EXPLAINED_TOPIC,
	FIRST_TOPIC,
	HOMEWORK_FIRST,
	HOMEWORK_MANY,
	HOMEWORK_OPEN,
	HOMEWORK_PRINTED,
	LAST_TOPIC,
	LONG_PROBLEM_TOPIC,
	OPEN_TOPICS,
	PROBLEM_FIRST_TOPIC,
	QUIZ_FILE_NAMES,
	SHEETLESS_TOPIC,
	SKIPPED_TOPIC,
	STUDIED_TOPICS,
	TWO_SHEETS_TOPIC,
	WAITING_TOPIC,
	WRITTEN_TOPIC,
} from "./layout-lessons.mjs";

/** The made-up plugin that shows in a lesson and in a space, installed from this folder. */
const PLUGIN_FOLDER = path.resolve(import.meta.dirname, "..", "tests", "fixtures", "plugins", "layout");

const FIXTURES = path.resolve(import.meta.dirname, "..", "tests", "fixtures");

/** Every made-up name has letters that hang below the line (g, j, p, q, y), so the check for
 *  cut-off letters has something to catch. */
const DEADLINE = "Pop quiz: graphing";
/** The most work items a drain answers, and the most 250 ms waits for the lessons to end their turns. */
const MOST_ITEMS = 80;
const LESSON_POLLS = 480;
/** Lab Algebra's facts by topic, so the Graph has topics that need and lead to others: Solving
 *  linear equations needs the first two and leads to the last two. */
const LAB_TOPICS = [
	{ name: "Inverse operations", material: "concept", facts: [["Undo in reverse", "To solve ax + b = c, subtract b from both sides, then divide by a."], ["Inverse operations", "Subtraction undoes addition and division undoes multiplication."]] },
	{ name: "Equality rules", material: "term", facts: [["Same change both sides", "Doing the same operation to both sides of an equation keeps it true."], ["No dividing by zero", "Dividing both sides of an equation by zero is never allowed."]] },
	{ name: "Solving linear equations", material: "procedure", facts: [["Isolate the variable", "Solving ax + b = c means isolating x by undoing each operation on it."], ["Check a solution", "Putting the answer back into the equation checks it."]] },
	{ name: "Graphing lines", material: "procedure", facts: [["Slope-intercept form", "y = mx + b has slope m and y-intercept b."], ["Crossing point", "Where two lines cross is the solution both equations share."]] },
	{ name: "Word problems", material: "procedure", facts: [["Translate words", "A word problem becomes an equation once each quantity has a symbol."], ["Units check", "An answer's units must match what the question asks for."]] },
];
const LAB_FACTS = LAB_TOPICS.flatMap((t) => t.facts);
const local = (name) => `p${LAB_FACTS.findIndex(([n]) => n === name) + 1}`;
/** Each chain joins two topics, which links them. */
const LAB_CHAINS = [
	[["Inverse operations"], "Isolate the variable"],
	[["Same change both sides"], "Isolate the variable"],
	[["Undo in reverse"], "Check a solution"],
	[["Isolate the variable"], "Crossing point"],
	[["Isolate the variable"], "Translate words"],
].map(([premises, conclusion]) => ({ premises: premises.map(local), conclusion: local(conclusion) }));
/** The second space's one file and its two facts. */
const BACKEND_FILE = "HTTP basics.md";
const BACKEND_FACTS = [
	["Status codes", "A 4xx status means the request was wrong; a 5xx status means the server failed."],
	["Idempotent methods", "Sending a PUT or DELETE twice leaves the server as sending it once does."],
];
/** The printed worksheet that is Homework 6's assignment. */
const WORKSHEET = path.resolve(import.meta.dirname, "..", "crates", "pdf", "tests", "fixtures", "worksheet.pdf");

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
 *  JSON starts with this field, so it is read off the text. `text` is the whole item. */
export function workOf(text) {
	const field = (name) => new RegExp(`"${name}":"([^"\\\\]+)"`).exec(text)?.[1];
	return { task: field("task"), text };
}

/** The day `days` from now on this computer's calendar, as YYYY-MM-DD. */
function inDays(days) {
	const day = new Date(Date.now() + days * 86_400_000);
	return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
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

/** The stand-in's answer to a work item, or null for one it does not expect. */
function answerFor(work, ids) {
	if (work.task?.startsWith("Cheat sheet: ")) return sheetAnswer(work, ids);
	if (/^Mock \d+: questions$/.test(work.task ?? "")) return { tool_calls: [{ name: "write_mock_questions", arguments: { questions: MOCK_QUESTIONS } }] };
	if (/^Mock \d+: grading$/.test(work.task ?? "")) return { tool_calls: [{ name: "grade_mock", arguments: { grades: MOCK_GRADES } }] };
	if (work.task?.startsWith("Graph extraction")) {
		const backend = work.task.includes(BACKEND_FILE);
		const propositions = (backend ? BACKEND_FACTS : LAB_FACTS).map(([name, statement], i) => ({ id: `p${i + 1}`, name, statement }));
		return { tool_calls: [{ name: "submit_findings", arguments: { propositions, chains: backend ? [] : LAB_CHAINS, reteaches: [] } }] };
	}
	// godspeed's own grouping of Lab Algebra's facts, a background job: the facts come one per line as "id | name | statement".
	if (work.task?.startsWith("Topic grouping")) {
		const ids = new Map([...work.text.matchAll(/(n_[0-9a-z]+) \| ([^|]+?) \|/g)].map((m) => [m[2], m[1]]));
		const topics = LAB_TOPICS.map((t) => ({ name: t.name, material: t.material, members: t.facts.map(([name]) => ids.get(name)).filter(Boolean) }));
		return { tool_calls: [{ name: "submit_topics", arguments: { topics } }] };
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
/** Two vaults Obsidian lists in the throwaway home, the first holding one note: Settings shows them
 *  as keys until a screen picks one. Returns the first vault's path. */
function listVaults(dataDir) {
	const home = path.join(dataDir, "..", "home");
	const vaults = ["Documents/Lab notes", "Documents/Reading"].map((name) => path.join(home, name));
	for (const vault of vaults) fs.mkdirSync(path.join(vault, ".obsidian"), { recursive: true });
	fs.writeFileSync(path.join(vaults[0], "Slope.md"), "# Slope\n\nRise over run.\n");
	const list = path.join(home, "Library", "Application Support", "obsidian");
	fs.mkdirSync(list, { recursive: true });
	fs.writeFileSync(path.join(list, "obsidian.json"), JSON.stringify({ vaults: Object.fromEntries(vaults.map((vault, n) => [`v${n}`, { path: vault, ts: 1 + n }])) }));
	return fs.realpathSync(vaults[0]);
}

export async function seed(dataDir, page, log) {
	const vault = listVaults(dataDir);
	const agent = standIn(dataDir, log);
	await agent.init();
	const helperDir = path.join(dataDir, "..", "helper");
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
	// The first lesson cites it, so the stand-in helper is told it before any lesson starts.
	fs.writeFileSync(path.join(helperDir, "passage"), passage);
	const { lessonId } = await agent.json("start_lesson", { topic: FIRST_TOPIC, space_id: space.id });

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
	// The worksheet's source: a .tex with its name, so the two are one row on Files. It is never read, so the work loop gets nothing new.
	// Written beside the data folder, as a file added by text is always Markdown.
	const worksheetTex = path.join(path.dirname(dataDir), "worksheet.tex");
	fs.writeFileSync(worksheetTex, "\\documentclass{article}\n\\begin{document}\nHomework 6\n\\end{document}\n");
	await agent.call("add_space_file", { space_id: space.id, kind: "info", path: worksheetTex });
	await agent.call("update_space_deadline", { space_id: space.id, deadline_id: deadlineNamed(HOMEWORK_PRINTED), assignment_file_id: worksheet.id });
	const homeworkOpen = await homeworkLesson(HOMEWORK_OPEN);
	const homeworkPrinted = await homeworkLesson(HOMEWORK_PRINTED);
	const homeworkFirst = await homeworkLesson(HOMEWORK_FIRST);
	const homeworkMany = await homeworkLesson(HOMEWORK_MANY);
	// The lesson on files starts as the teacher's start_lesson starts one, on the quiz with its key.
	const quizFiles = [];
	for (const name of QUIZ_FILE_NAMES) quizFiles.push((await agent.json("add_space_file", { space_id: space.id, kind: "info", path: path.join(FIXTURES, name) })).file.id);
	const filesLesson = (await agent.json("start_lesson", { space_id: space.id, file_ids: quizFiles })).lessonId;
	const written = (await agent.json("start_lesson", { topic: WRITTEN_TOPIC, space_id: space.id })).lessonId;
	const startLesson = async (topic) => (await agent.json("start_lesson", { topic, space_id: space.id })).lessonId;
	const studied = [];
	for (const topic of STUDIED_TOPICS) studied.push(await startLesson(topic));
	const open = [];
	for (const topic of OPEN_TOPICS) open.push(await startLesson(topic));
	const longProblem = await startLesson(LONG_PROBLEM_TOPIC);
	const problemFirst = await startLesson(PROBLEM_FIRST_TOPIC);
	const twoSheets = await startLesson(TWO_SHEETS_TOPIC);
	const askedFirst = await startLesson(ASKED_FIRST_TOPIC);
	const codeChoices = await startLesson(CODE_CHOICES_TOPIC);
	const turnStates = { explained: await startLesson(EXPLAINED_TOPIC), concluded: await startLesson(CONCLUDED_TOPIC), skipped: await startLesson(SKIPPED_TOPIC), discarded: await startLesson(DISCARDED_TOPIC), lastTopic: await startLesson(LAST_TOPIC) };

	/** Every lesson made, so the seed can wait for their turns to end. */
	const lessonIds = [lessonId, homeworkOpen, homeworkPrinted, homeworkFirst, homeworkMany, filesLesson, written, ...studied, ...open, longProblem, problemFirst, twoSheets, askedFirst, codeChoices, ...Object.values(turnStates)];

	// Answer every item until the queue stays empty for two teacher and two helper waits in a row.
	// godspeed's own jobs (the graph, the space check, sheets and mocks) are work items; an empty
	// wait hands over to the other kind, and a wait that brought work asks as the same kind again.
	let helper = false;
	const wait = () => agent.call("wait_for_work", { timeout_seconds: 3, ...(helper ? { helper: true } : {}) });
	const ids = { passage, space: space.id, deadline: deadlineNamed(DEADLINE) };
	const drain = async () => {
		let reply = await wait();
		for (let idle = 0, tries = 0; idle < 4; tries++) {
			if (tries > MOST_ITEMS) throw new Error("the stand-in agent never ran out of work");
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
			const answer = answerFor(work, ids);
			if (!answer) throw new Error(`the stand-in agent got work it does not expect: ${work.task}`);
			reply = await agent.call("respond", { work_id: header.workId, ...answer, wait_seconds: 0 });
		}
	};
	/** Waits until no lesson's turn runs. A turn that failed is an error here, not a lesson that stays blank. */
	const lessonsIdle = async () => {
		for (let tries = 0, quiet = 0; quiet < 2; tries++) {
			if (tries > LESSON_POLLS) throw new Error("a lesson's turn never ended");
			const chats = await Promise.all(lessonIds.map((id) => page.json(`/api/chats/${id}`)));
			const failed = chats.find((chat) => chat.turnError);
			if (failed) throw new Error(`a lesson's turn failed: ${failed.turnError}`);
			quiet = chats.some((chat) => chat.turnInFlight) ? 0 : quiet + 1;
			await new Promise((done) => setTimeout(done, 250));
		}
	};
	/** The jobs and the lessons run side by side; both are done when this returns. */
	const settle = async () => {
		await drain();
		await lessonsIdle();
	};
	await settle();
	// The learner says which part they start; the teacher marks it.
	await page.fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId: homeworkOpen, input: { type: "text", text: "I am starting part (b)." } }) });
	await page.fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId: homeworkMany, input: { type: "text", text: "They cross at (2, 7)." } }) });
	await page.fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId: homeworkPrinted, input: { type: "text", text: "I am starting part (b)." } }) });
	await page.fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId: filesLesson, input: { type: "text", text: "The slope is 3." } }) });
	/** The lesson's newest call of the tool `name`. */
	const lastCall = async (chatId, name) => {
		const { messages } = await page.json(`/api/chats/${chatId}`);
		return messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).findLast((block) => block.type === "toolCall" && block.name === name);
	};
	const say = (chatId, input) => page.fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId, input }) });
	/** The learner picks the right answer of the lesson's open quiz. The answer keeps the choices, as the question box's does, so the answered card shows the pick. */
	const answerQuiz = async (chatId) => {
		const quiz = await lastCall(chatId, "quiz");
		const { question, options, correctAnswer } = quiz.arguments;
		const index = options.findIndex((option) => (option.value ?? option.label) === correctAnswer) + 1;
		const answer = { kind: "quiz", tool: "quiz", questionText: question, dontKnow: false, options: options.map((option, at) => ({ index: at + 1, label: option.label })), answers: [{ label: correctAnswer, value: correctAnswer, index }], correct: true, answeredAt: new Date().toISOString() };
		await say(chatId, { type: "answer", toolCallId: quiz.id, answer });
	};
	// The learner answers the concluded lesson's problem, skips the skipped one's quiz, answers the last-topic one's quiz right and drops the discarded one's problem, as the window's Skip and Discard do.
	await say(turnStates.concluded, { type: "text", text: "x = 4, and 3(4) + 2 = 14 = 4 + 10." });
	const skip = await lastCall(turnStates.skipped, "quiz");
	await say(turnStates.skipped, { type: "answer", toolCallId: skip.id, answer: { kind: "quiz", questionText: skip.arguments.question, dontKnow: false, answers: [], dismissed: true, answeredAt: new Date().toISOString() } });
	await answerQuiz(turnStates.lastTopic);
	const dropped = await lastCall(turnStates.discarded, "problem");
	await page.fetch(`/api/chats/${turnStates.discarded}/dismiss`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: { type: "dismiss-problem", problemCallId: dropped.id } }) });
	// The learner answers each studied lesson's quiz right, and the teacher closes the lesson. The
	// sheet lessons' first step is answered too, and their teacher asks about the last.
	for (const chatId of [...studied, twoSheets, askedFirst]) await answerQuiz(chatId);
	await settle();
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
	// One sheet lesson's last step is answered; in the other the learner asks first and its question stays open.
	await answerQuiz(twoSheets);
	await say(askedFirst, { type: "side", text: ASKED_FIRST });
	await settle();
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
	await agent.call("add_space_file", { space_id: goal.space.id, kind: "study", name: BACKEND_FILE, text: "# HTTP basics\n\nA 4xx status means the request was wrong; a 5xx status means the server failed. PUT and DELETE are idempotent." });
	// A lesson in the space with no deadline: its cheat sheet column has no sheet to show.
	const sheetless = (await agent.json("start_lesson", { topic: SHEETLESS_TOPIC, space_id: goal.space.id })).lessonId;
	lessonIds.push(sheetless);
	await settle();
	// Lab Algebra's facts are sorted into topics a while after the last file is read; the stand-in answers that too.
	for (let tries = 0; ; tries++) {
		const { topics } = await page.json(`/api/progress?space=${space.id}&today=${inDays(0)}`);
		if (topics.some((topic) => !topic.ungrouped)) break;
		if (tries > 20) throw new Error("Lab Algebra's facts were never sorted into topics");
		await drain();
	}
	return { vault, ...turnStates, quizAnswered: studied[0], sheetless, space: space.id, sheetMade: midterm, sheetVersions: quiz, mockRunDeadline: reviewQuiz, waitingDeadline: deadlineNamed(SPRING_EXAM), mockGraded: graded, mockReady: ready, mockRunning: running, mockPaused: paused, lesson: lessonId, written, longProblem, problemFirst, twoSheets, askedFirst, codeChoices, pending, deadline: ids.deadline, homeworkOpen, homeworkFirst, homeworkMany, homeworkPrinted, filesLesson, homeworkOpenDeadline: deadlineNamed(HOMEWORK_OPEN), homeworkFirstDeadline: deadlineNamed(HOMEWORK_FIRST), homeworkManyDeadline: deadlineNamed(HOMEWORK_MANY), homeworkPrintedDeadline: deadlineNamed(HOMEWORK_PRINTED), pathSpace: goal.space.id };
}
