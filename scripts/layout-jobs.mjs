/**
 * layout-jobs.mjs — godspeed's background jobs in `npm run layout`, and the stand-in helper's
 * fixed answer to each (layout-helper.mjs): a graph run's facts, the topic grouping, the space
 * check, a deadline's request, a cheat sheet and a mock's questions and grades. The seed
 * (layout-seed.mjs) names its deadlines and its second space's file from here, so a job knows them.
 * A job is told by the tool it must call, or by its request's first words.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export const FIXTURES = path.resolve(import.meta.dirname, "..", "tests", "fixtures");

/** A passage's id in a tool's answer: a file id and a place in the file. */
export const PASSAGE = /f_[0-9a-f]{12}:\d+/;

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** The day `days` from now on this computer's calendar, as YYYY-MM-DD. */
export const inDays = (days) => new Date(Date.now() + days * 86_400_000).toLocaleDateString("sv");

/** Every made-up name has letters that hang below the line (g, j, p, q, y), so the check for
 *  cut-off letters has something to catch. */
export const DEADLINE = "Pop quiz: graphing";
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
export const BACKEND_FILE = "HTTP basics.md";
const BACKEND_FACTS = [
	["Status codes", "A 4xx status means the request was wrong; a 5xx status means the server failed."],
	["Idempotent methods", "Sending a PUT or DELETE twice leaves the server as sending it once does."],
];
/** Deadlines for the cheat sheet and mock pages, far off so Home stays as it was. The spring
 *  exam's sheet and mock are never answered: a screen shows them being made. */
export const MIDTERM = "Midterm: graphing and systems";
export const QUIZ = "Quiz 2: slopes and intercepts";
export const SPRING_EXAM = "Spring exam: everything so far";

export const SHEET_ASKS = {
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
const MOCK_GRADES = [
	{ question: "q1", verdict: "right", feedback: "You said that adding 3 came last, so it is undone first, and you checked $x = 4$ in the equation. That is the whole idea." },
	{ question: "q2", verdict: "partly", feedback: "The formula is right, but it returns a decimal when $c - b$ is not a multiple of $a$, for example `solveLinear(2, 1, 4)`. Say what your function should do then, or round on purpose." },
];

/** The deadline a sheet's or a mock's request is for, off the line that names it. */
const forWhat = (text) => /^(?:Cheat sheet for|They are preparing for): (.*)$/m.exec(text)?.[1] ?? "";

/** The answer to a cheat sheet request. The PDF is copied into the sheet's working folder, where
 *  the job runs, as an agent's own tools would write it there. */
function sheetAnswer(job, passage) {
	const asked = job.text.split("The learner says:").pop();
	const key = asked.includes(SHEET_ASKS.short) ? "short" : forWhat(job.text).includes(MIDTERM) ? MIDTERM : QUIZ;
	fs.copyFileSync(path.join(FIXTURES, key === "short" ? "layout-sheet-one-page.pdf" : "layout-sheet-two-pages.pdf"), path.join(job.cwd, "sheet.pdf"));
	const reply = SHEET_REPLIES[key];
	return { tool_calls: [{ name: "sheet_reply", arguments: { ...reply, text: reply.text.replace("PASSAGE", passage), pdf_path: "sheet.pdf" } }] };
}

/** The check of Lab Algebra links the made-up file to the pop quiz; its request names the space's
 *  and the quiz's ids. The check of another space changes nothing. */
function checkAnswer(job, passage) {
	const space = /space_id (\S+?)\)/.exec(job.text)?.[1];
	const deadline = new RegExp(`- ${DEADLINE} \\([^)]*deadline_id (\\S+?),`).exec(job.text)?.[1];
	if (!space || !deadline || !passage) return { text: "Nothing to change." };
	return { text: "Linked the graphing notes to the quiz.", tool_calls: [{ name: "update_space_deadline", arguments: { space_id: space, deadline_id: deadline, file_ids: [passage.split(":")[0]] } }] };
}

/** The stand-in's answer to a job: `tools` are the names it may call, `text` its request, `cwd`
 *  the folder it runs in, `passage` the made-up file's passage. `{ holds: true }` for a job that
 *  stays unanswered until it is stopped, null for a job it does not expect. */
export function jobAnswer(job, passage) {
	const has = (name) => job.tools.includes(name);
	if ((has("sheet_reply") || has("write_mock_questions")) && forWhat(job.text).includes(SPRING_EXAM)) return { holds: true };
	if (has("sheet_reply")) return sheetAnswer(job, passage);
	if (has("write_mock_questions")) return { tool_calls: [{ name: "write_mock_questions", arguments: { questions: MOCK_QUESTIONS } }] };
	if (has("grade_mock")) return { tool_calls: [{ name: "grade_mock", arguments: { grades: MOCK_GRADES } }] };
	if (has("submit_findings")) {
		// The second space's file, by its name or its heading.
		const backend = job.text.includes(BACKEND_FILE.replace(/\.md$/, ""));
		const propositions = (backend ? BACKEND_FACTS : LAB_FACTS).map(([name, statement], i) => ({ id: `p${i + 1}`, name, statement }));
		return { tool_calls: [{ name: "submit_findings", arguments: { propositions, chains: backend ? [] : LAB_CHAINS, reteaches: [] } }] };
	}
	// The grouping of Lab Algebra's facts: they come one per line as "id | name | statement".
	if (has("submit_topics")) {
		const ids = new Map([...job.text.matchAll(/(n_[0-9a-z]+) \| ([^|]+?) \|/g)].map((m) => [m[2], m[1]]));
		const topics = LAB_TOPICS.map((t) => ({ name: t.name, material: t.material, members: t.facts.map(([name]) => ids.get(name)).filter(Boolean) }));
		return { tool_calls: [{ name: "submit_topics", arguments: { topics } }] };
	}
	if (job.text.startsWith("Check space ")) return checkAnswer(job, passage);
	// A deadline's request: what it covers, a study guide or what it is like.
	if (/^(Work out what|Write a study guide|Rewrite what this deadline)/.test(job.text)) return { text: `${DEADLINE} covers solving linear equations by graphing and by moving terms across the equals sign.` };
	return null;
}
