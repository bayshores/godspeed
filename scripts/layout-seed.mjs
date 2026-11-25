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
 * clock; the spring exam has nothing, so a screen can ask for a sheet and a mock that the stand-in
 * helper holds unanswered. The sheet and the mocks are made the way the window makes them. Every
 * job of godspeed's (the graph, the topics, the space check, sheets and mocks) plays on the stand-in
 * helper, which gives each the fixed answer in layout-jobs.mjs (a sheet's PDF is copied into the
 * sheet's working folder, as an agent's own tools would write it). A second space, "Backend jobs",
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
	CODE_WRITE_TOPIC,
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
import { BACKEND_FILE, DEADLINE, FIXTURES, MIDTERM, QUIZ, SHEET_ASKS, SPRING_EXAM } from "./layout-jobs.mjs";

/** The made-up plugin that shows in a lesson and in a space, installed from this folder. */
const PLUGIN_FOLDER = path.resolve(import.meta.dirname, "..", "tests", "fixtures", "plugins", "layout");

/** The most 250 ms waits for the lessons to end their turns, and for the jobs to end. */
const LESSON_POLLS = 480;
/** The printed worksheet that is Homework 6's assignment. */
const WORKSHEET = path.resolve(import.meta.dirname, "..", "crates", "pdf", "tests", "fixtures", "worksheet.pdf");

/** One more deadline for the cheat sheet and mock pages (layout-jobs.mjs has the others), far off
 *  so Home stays as it was. */
const REVIEW_QUIZ = "Review quiz: equations by graphing";

const MOCK_CODE = "function solveLinear(a, b, c) {\n\treturn (c - b) / a;\n}";
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

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** The day `days` from now on this computer's calendar, as YYYY-MM-DD. */
function inDays(days) {
	const day = new Date(Date.now() + days * 86_400_000);
	return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
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
		if (!passage) await sleep(300);
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
	// The worksheet's source: a .tex with its name, so the two are one row on Files. It is never read, so no job starts for it.
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
	const codeWrite = await startLesson(CODE_WRITE_TOPIC);
	const turnStates = { explained: await startLesson(EXPLAINED_TOPIC), concluded: await startLesson(CONCLUDED_TOPIC), skipped: await startLesson(SKIPPED_TOPIC), discarded: await startLesson(DISCARDED_TOPIC), lastTopic: await startLesson(LAST_TOPIC) };

	/** Every lesson made, so the seed can wait for their turns to end. */
	const lessonIds = [lessonId, homeworkOpen, homeworkPrinted, homeworkFirst, homeworkMany, filesLesson, written, ...studied, ...open, longProblem, problemFirst, twoSheets, askedFirst, codeChoices, codeWrite, ...Object.values(turnStates)];

	/** Waits until godspeed's jobs, which the stand-in helper answers, have ended: no graph run or
	 *  request in the activity feed, and no sheet or mock being made, for two seconds in a row. A
	 *  sheet or mock that failed is an error here. */
	const sheetDeadlines = [MIDTERM, QUIZ].map(deadlineNamed);
	const jobsIdle = async () => {
		for (let tries = 0, quiet = 0; quiet < 8; tries++) {
			if (tries > LESSON_POLLS) throw new Error("godspeed's jobs never ended");
			const feed = await page.json("/api/activity");
			const { mocks } = await page.json(`/api/spaces/${space.id}/mocks`);
			const sheets = await Promise.all(sheetDeadlines.map((id) => page.json(`/api/spaces/${space.id}/deadlines/${id}/cheat-sheet`)));
			const failed = [...mocks, ...sheets].find((made) => made.error);
			if (failed) throw new Error(`a job failed: ${JSON.stringify(failed.error)}`);
			const busy = feed.extractions.length > 0 || feed.requests.length > 0 || mocks.some((mock) => mock.working) || sheets.some((sheet) => sheet.running);
			quiet = busy ? 0 : quiet + 1;
			await sleep(250);
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
			await sleep(250);
		}
	};
	/** The jobs and the lessons run side by side; both are done when this returns. */
	const settle = async () => {
		await jobsIdle();
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
		const answer = { kind: "quiz", tool: "quiz", questionText: question, dontKnow: false, options: options.map((option, at) => ({ index: at + 1, label: option.label })), answers: [{ label: correctAnswer, value: correctAnswer, index }], correctIndices: [index], correct: true, answeredAt: new Date().toISOString() };
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
	// The learner asks for the first sheets and mocks; the stand-in helper answers each request.
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
	await jobsIdle();
	// The midterm's next mock is made once the last one is graded; it waits to be started.
	await send(`/api/spaces/${space.id}/mocks`, { deadlineId: midterm, questions: 3 });
	await jobsIdle();
	const ready = await mockOf(midterm, 2);
	// A lesson made as the window's Study does, whose first message the window sends when it opens: the stand-in helper holds its reply.
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
		if (tries > LESSON_POLLS) throw new Error("Lab Algebra's facts were never sorted into topics");
		await sleep(250);
	}
	await jobsIdle();
	return { vault, ...turnStates, quizAnswered: studied[0], sheetless, space: space.id, sheetMade: midterm, sheetVersions: quiz, mockRunDeadline: reviewQuiz, waitingDeadline: deadlineNamed(SPRING_EXAM), mockGraded: graded, mockReady: ready, mockRunning: running, mockPaused: paused, lesson: lessonId, written, longProblem, problemFirst, twoSheets, askedFirst, codeChoices, codeWrite, pending, deadline: deadlineNamed(DEADLINE), homeworkOpen, homeworkFirst, homeworkMany, homeworkPrinted, filesLesson, homeworkOpenDeadline: deadlineNamed(HOMEWORK_OPEN), homeworkFirstDeadline: deadlineNamed(HOMEWORK_FIRST), homeworkManyDeadline: deadlineNamed(HOMEWORK_MANY), homeworkPrintedDeadline: deadlineNamed(HOMEWORK_PRINTED), pathSpace: goal.space.id };
}
