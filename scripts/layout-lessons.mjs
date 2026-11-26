/**
 * layout-lessons.mjs — the made-up lessons `npm run layout` plays, and what the stand-in helper
 * (layout-helper.mjs) says in each. A lesson is known by the first message its session is sent:
 * a topic lesson's title is a part of its own, and a homework lesson names its deadline.
 *
 * A lesson is a list of replies, played in order across its turns. A reply may say `text`, then
 * call godspeed's lesson tools (`tool_calls`). A turn goes on to the next reply until a tool ends
 * it (a question for the learner), a reply calls no tool, or the list runs out. `{passage}` stands
 * for the id of a passage of the space's file, which the seed names. A lesson that `holds` never
 * answers: its turn waits to be stopped.
 *
 * The lessons stand at every state the screens show: a plan and a sourced reply that ends in a
 * quiz; homework ones with their problems posted; one on files; studied ones and open ones; one
 * per state of "Your turn"; and one that holds its reply.
 */
/** How the server's refusal of a card tagged past an unasked plan step reads. */
export const PLAN_ORDER_SENT_BACK = "comes first and nothing in this lesson asked it";

const WEB_SOURCE = "[[https://example.com/lab-algebra/linear-equations]]";

/** A teacher panel chat's message with these words holds its turn in the stand-in helper. */
export const TALK_HOLDS = "run my slope checker";
/** A teacher panel chat message with these words is the teacher's round of work that Follow's slip shows (layout-helper.mjs). */
export const TALK_ROUND = "Update Lab Algebra";

export const FIRST_TOPIC = "Solving linear equations by graphing";
/** The lesson whose reply the helper holds; its address sends the first message (layout-screens.mjs). */
export const WAITING_TOPIC = "Graphing two lines to find where they cross";
/** A lesson in the second space, which has no deadline. */
export const SHEETLESS_TOPIC = "Git and pull requests";

/** The figure under the method the second homework lesson teaches first: 19 back to 15, then to 5. */
const METHOD_FIGURE = `<svg viewBox="0 0 640 200"><title>Undoing 3x + 4 = 19 on a number line</title>
<line x1="40" y1="130" x2="600" y2="130" stroke="var(--soft)" stroke-width="2"/>
${[0, 5, 10, 15, 20].map((n) => `<line x1="${60 + n * 26}" y1="122" x2="${60 + n * 26}" y2="138" stroke="var(--soft)" stroke-width="2"/><text x="${60 + n * 26}" y="162" text-anchor="middle" font-size="15" fill="var(--soft)">${n}</text>`).join("")}
<path d="M554 118 Q502 60 454 114" fill="none" stroke="var(--ink)" stroke-width="2"/><path d="M454 114 l2 -12 M454 114 l11 -5" fill="none" stroke="var(--ink)" stroke-width="2"/>
<text x="504" y="62" text-anchor="middle" font-size="16">1. subtract 4</text>
<path d="M446 118 Q318 20 194 114" fill="none" stroke="var(--accent)" stroke-width="2"/><path d="M194 114 l3 -12 M194 114 l12 -4" fill="none" stroke="var(--accent)" stroke-width="2"/>
<text x="300" y="40" text-anchor="middle" font-size="16" fill="var(--accent)">2. divide by 3</text>
<circle cx="554" cy="130" r="5"/><circle cx="450" cy="130" r="5"/><circle cx="190" cy="130" r="6" fill="var(--accent)"/>
<text x="554" y="186" text-anchor="middle" font-size="15">3x + 4</text><text x="450" y="186" text-anchor="middle" font-size="15">3x</text><text x="190" y="186" text-anchor="middle" font-size="15" fill="var(--accent)">x</text>
</svg>`;

/** The homework deadlines, each worked in its own lesson ("Work on <name>"). */
export const HOMEWORK_OPEN = "Homework 3: graphing lines";
export const HOMEWORK_FIRST = "Homework 4: solving equations";
export const HOMEWORK_MANY = "Homework 5: graphing systems";
/** A homework whose assignment is a printed worksheet: its problems show as pieces of its pages. */
export const HOMEWORK_PRINTED = "Homework 6: a printed worksheet";
/** The worksheet's problems, pointed at by their first words; the second runs onto page 2. */
const PRINTED_PROBLEMS = [
	{ number: "1", title: "Flipping a coin", source: { page: 1, starts: "1. First problem" } },
	{ number: "2", title: "A queue of lists", source: { page: 1, starts: "2. Second problem" } },
	{ number: "3", title: "Counting handshakes", source: { page: 2, starts: "3. Third problem" } },
];
/** The lesson on files: a practice quiz and its answer key, its problems pointed at by their first
 *  words. Problem 2 ends where page 2's running title starts, so its cut leaves that title out. */
export const QUIZ_FILE_NAMES = ["Graphing practice quiz.pdf", "Graphing practice quiz key.pdf"];
const FILES_TITLE = "Graphing practice quiz";
const QUIZ_PROBLEMS = [
	{ number: "1", title: "Slope through two points", source: { page: 1, starts: "1. Find the slope" } },
	{ number: "2", title: "Graphing y = 2x - 3", source: { page: 1, starts: "2. Graph the line", ends: "Graphing practice quiz, continued" } },
	{ number: "3", title: "Solve and check", source: { page: 2, starts: "3. Solve" } },
	{ number: "4", title: "Taxi fares", source: { page: 2, starts: "4. A taxi" } },
];

/** More problems than a row names, numbered as an assignment might ("2a"). */
const MANY_NUMBERS = ["1", "2a", "2b", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"];
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

/** Lessons the Lessons block lists besides the first lesson and the homework ones. */
export const STUDIED_TOPICS = [
	"Slope",
	"Intercepts of a line",
	"Solving two-step equations",
	"Graphing systems of equations",
	"Parallel and perpendicular lines",
	"Word problems with one unknown, the kind that hides the equation in a story about trains",
	"Absolute value",
	"Reading a graph",
];
export const OPEN_TOPICS = ["Inequalities on a number line", "Slope-intercept form, with every kind of mistake people make while plotting by hand and reading the result back"];
/** A lesson whose question is answered in words, so "Your turn" holds a three-line box. */
export const WRITTEN_TOPIC = "Why undo in reverse";
const WRITTEN_REPLY = {
	text: "An equation is a balance: whatever you do to one side, you do to the other, so it stays true.\n\nTo solve 3x - 5 = 10, look at what was done to x: first it was multiplied by 3, then 5 was taken away. Undo those in reverse. Add 5 to both sides to get 3x = 15, then divide both sides by 3 to get x = 5.",
	tool_calls: [{ name: "ask_user_question", arguments: { question: "In your own words, why do we undo the steps in reverse order?" } }],
};
/** A lesson whose first reply is a problem and no words, so "Your turn" stands alone. */
export const PROBLEM_FIRST_TOPIC = "Slope from two points";
const PROBLEM_FIRST = "A line passes through $(1, 2)$ and $(4, 11)$.\n\n(a) Find its slope.\n\n(b) Write its equation in the form $y = mx + b$.";
/** A lesson whose open practice problem is one part longer than the window. */
export const LONG_PROBLEM_TOPIC = "Equations from a story";
const LONG_PROBLEM = [
	"Two trains leave stations 300 miles apart at noon and run toward each other on the same line. The first runs at a steady $x$ miles an hour. The second runs 15 miles an hour faster than the first, but it stops for half an hour at a town halfway along before it goes on at the same speed.",
	"A dispatcher sees them pass each other at a quarter to three. She writes one equation for the distance the first train covers, one for the second, and sets their sum equal to the distance between the stations:",
	"$$x \\cdot 2.75 + (x + 15)(2.75 - 0.5) = 300$$",
	"Say what each piece of her equation stands for, in words, and why the second train's time is shorter than the first train's. Then solve for $x$, and give both trains' speeds.",
	"Last, check your answer: put both speeds back into the story and work out how far each train has gone when they pass. Do the two distances add up to 300 miles? If they do not, find the step where the equation and the story stopped agreeing, and fix it.",
].join("\n\n");

/** Two lessons whose two steps each have a sheet in the lesson text. In the first both steps'
 *  questions are answered; in the second the learner asks something of their own while the last
 *  step's question is still open. */
export const TWO_SHEETS_TOPIC = "Two-step equations";
export const ASKED_FIRST_TOPIC = "Checking a solution";
export const ASKED_FIRST = "Why do I check it at all?";
const SHEET_STEPS = [
	{
		text: "To solve $2x + 3 = 11$, undo what was done to $x$, last step first. Adding 3 came last, so subtract 3 from both sides: $2x = 8$.",
		quiz: { type: "predict", nodeId: "first-step", question: "What is left to undo in $2x = 8$?", options: ["The multiplying by 2", "The adding of 3"], correctAnswer: "The multiplying by 2", explanation: "The 3 is gone, so only the 2 is left on $x$." },
	},
	{
		text: "Your pick, the multiplying by 2, holds. Divide both sides by 2 and $x = 4$.\n\nNow the last step, the check: put the answer back into the equation you started from.",
		quiz: { type: "check", nodeId: "last-step", question: "Which line checks $x = 4$ in $2x + 3 = 11$?", options: ["$2 \\cdot 4 + 3 = 11$", "$4 + 3 = 11$"], correctAnswer: "$2 \\cdot 4 + 3 = 11$", explanation: "The 4 goes where $x$ was, so it is still multiplied by 2." },
	},
];
const SHEET_ENDS = {
	answered: "Your pick, $2 \\cdot 4 + 3 = 11$, holds: 8 and 3 make 11, so $x = 4$ solves it.",
	asked: "A check catches a slip in the steps. If the two sides do not come out equal, one of the steps was wrong, and you find it before anyone else does.",
};
/** A lesson whose question shows code and whose four choices are code blocks: more than the window holds. */
export const CODE_CHOICES_TOPIC = "A function that solves it";
const fenced = (body) => "```js\nfunction solveLinear(a, b, c) {\n" + body + "\n}\n```";
const CODE_CHOICES = [
	fenced("\tconst left = c - b;\n\treturn left / a;"),
	fenced("\tconst left = c + b;\n\treturn left / a;"),
	fenced("\tconst left = c - b;\n\treturn left * a;"),
	fenced("\tconst left = c / a;\n\treturn left - b;"),
];
const CODE_QUIZ = {
	type: "check",
	nodeId: "first-step",
	question: "`solveLinear(a, b, c)` returns the number that solves the equation. It is called like this:\n\n```js\nsolveLinear(2, 3, 11); // 4\n```\n\nWhich version is correct?",
	options: CODE_CHOICES.map((label) => ({ label, value: label })),
	correctAnswer: CODE_CHOICES[0],
	explanation: "Subtract b first, then divide by a.",
};
/** A lesson whose question is answered in the code editor, which starts with the teacher's code. */
export const CODE_WRITE_TOPIC = "Writing the solver";
const CODE_WRITE = {
	question: "Finish `solveLinear` so it returns the number that solves $ax + b = c$.",
	language: "javascript",
	starter: "function solveLinear(a, b, c) {\n\t// undo the adding, then the multiplying\n\t\n}\n\nconsole.log(solveLinear(2, 3, 11)); // 4",
};

/** Lessons that each stop at one state of "Your turn" with nothing to answer: the teacher
 *  explained and asked nothing; a problem concluded, which ends its topic; a question skipped
 *  and answered; a problem discarded; the last topic ended. */
export const EXPLAINED_TOPIC = "Isolating the variable";
const EXPLAINED = "To get $x$ alone in $4x - 1 = 7$, undo the subtraction first: add 1 to both sides to get $4x = 8$. Then undo the multiplying: divide both sides by 4, and $x = 2$.";
export const CONCLUDED_TOPIC = "Slope from a graph";
export const SKIPPED_TOPIC = "Equations with fractions";
export const DISCARDED_TOPIC = "Equations with variables on both sides";
export const LAST_TOPIC = "Checking by substitution";
/** A plan of one step, so the topic its quiz ends is the last. */
const ONE_STEP = "graph TD\n  only-step[Put it back]";
const TWO_STEPS = "graph TD\n  first-step[First step] --> last-step[Last step]";
/** The problem the concluded and the discarded lessons pose. */
const STEP_PROBLEM = { nodeId: "first-step", statement: "Solve $3x + 2 = x + 10$ and check your answer.", mode: "recall", modelSolution: "2x = 8, so x = 4; 3(4) + 2 = 14 = 4 + 10." };

const call = (name, args) => ({ name, arguments: args });
const plan = (mermaid = TWO_STEPS) => ({ text: "Here is the plan.", tool_calls: [call("plan_init", { mermaid })] });
const say = (text) => ({ text });
const asking = (text, tool, args) => ({ ...(text ? { text } : {}), tool_calls: [call(tool, args)] });
const quiz = (nodeId) => ({ type: "check", nodeId, question: "What is x when 3x = 12?", options: [{ label: "4", value: "4" }, { label: "9", value: "9" }], explanation: "Divide both sides by 3.", correctAnswer: "4" });
const pose = (number, nodeId, modelSolution) => call("problem", { number, nodeId, mode: "recall", modelSolution });

/** A plan of two steps, a quiz on a step (the last for a studied lesson, the first for an open
 *  one), and a closing line after the learner answered. */
function shortLesson(studied) {
	const options = [{ label: "4", value: "4" }, { label: "7", value: "7" }];
	const question = { type: "check", nodeId: studied ? "last-step" : "first-step", question: "What is x when x + 3 = 7?", options, explanation: "Subtract 3 from both sides.", correctAnswer: "4" };
	return [plan(), asking("Try this one.", "quiz", question), say("That is right.")];
}

/** A plan, then each step taught with a question; after the last answer, or the learner's own
 *  question, the closing line. */
function sheetLesson(asked) {
	const steps = SHEET_STEPS.map((step) => asking(step.text, "quiz", { ...step.quiz, options: step.quiz.options.map((label) => ({ label, value: label })) }));
	return [plan(), ...steps, say(asked ? SHEET_ENDS.asked : SHEET_ENDS.answered)];
}

/** A topic of a space that has topics is titled "Study: <topic>"; one with none, by what was typed. */
const topic = (title) => (parts) => parts.some((part) => [title, `Study: ${title}`].includes(part.trim()));
const homework = (name) => (parts) => parts.some((part) => part.trim() === `Work on ${name}` || part.includes(`working on ${name} (`));

/** Every lesson: `is` reads its first input, `replies` is what it says, in order. */
export const LESSONS = [
	{
		is: topic(FIRST_TOPIC),
		replies: [
			plan("graph TD\n  read-equation[Read the equation] --> undo-adding[Undo adding] --> undo-multiplying[Undo multiplying] --> check-by-graphing[Check by graphing] --> word-problems[Word problems]"),
			asking(`To solve 2x + 3 = 11, undo each step in reverse: subtract 3 from both sides, then divide by 2. [[{passage}]] Graphing y = 2x + 3 shows the same answer. ${WEB_SOURCE}`, "quiz", {
				type: "predict",
				nodeId: "undo-adding",
				question: "What is x when 2x + 3 = 11?",
				options: [{ label: "4", value: "4" }, { label: "7", value: "7" }, { label: "5.5", value: "5.5" }],
				explanation: "Subtract 3 to get 2x = 8, then divide by 2.",
				correctAnswer: "4",
			}),
		],
	},
	// Posts its problems and opens the first; after the learner says which part they start, marks
	// part (b) and says so.
	{
		is: homework(HOMEWORK_OPEN),
		replies: [
			{ tool_calls: [call("post_problems", { problems: HOMEWORK_PROBLEMS[HOMEWORK_OPEN] }), call("problem", { number: "1", statement: HOMEWORK_PROBLEMS[HOMEWORK_OPEN][0].text })] },
			asking("", "part", { part: "b" }),
			say("Part (b) it is. Undo the subtraction first."),
		],
	},
	// Posts its problems, then teaches the method first with a figure, with no problem open.
	{
		is: homework(HOMEWORK_FIRST),
		replies: [
			asking("", "post_problems", { problems: HOMEWORK_PROBLEMS[HOMEWORK_FIRST] }),
			asking("Before problem 1, here is the method. To solve $3x + 4 = 19$, undo each step in reverse: subtract 4 from both sides to get $3x = 15$, then divide both sides by 3 to get $x = 5$. The figure shows both steps on a number line.", "visual", { svg: METHOD_FIGURE }),
		],
	},
	// Posts the worksheet's problems by where they are printed and opens the second; after the
	// learner says which part they start, marks part (b).
	{
		is: homework(HOMEWORK_PRINTED),
		replies: [{ tool_calls: [call("post_problems", { problems: PRINTED_PROBLEMS }), call("problem", { number: "2" })] }, asking("", "part", { part: "b" }), say("Part (b) it is. What does the loop change each time around?")],
	},
	// Posts its problems and opens the first; after the learner's answer, closes it solved.
	{
		is: homework(HOMEWORK_MANY),
		replies: [
			{ tool_calls: [call("post_problems", { problems: HOMEWORK_PROBLEMS[HOMEWORK_MANY] }), call("problem", { number: "1", statement: HOMEWORK_PROBLEMS[HOMEWORK_MANY][0].text })] },
			asking("", "conclude", { outcome: "solved", verdict: "Both lines cross at (2, 7), as you found." }),
			say("That's the crossing. Pick any problem next."),
		],
	},
	// Writes its plan and posts the quiz's problems from its pages, then opens the first; after the
	// learner's answer it closes it solved, then opens the second.
	{
		is: (parts) => parts.some((part) => part.trim().startsWith(FILES_TITLE)),
		replies: [
			{ text: "Here is the plan.", tool_calls: [call("plan_init", { mermaid: "graph TD\n  slope[Slope] --> graph-a-line[Graph a line]" }), call("post_problems", { problems: QUIZ_PROBLEMS })] },
			{ tool_calls: [pose("1", "slope", "(11 - 2) / (4 - 1) = 3.")] },
			asking("", "conclude", { outcome: "solved", verdict: "Slope 3: up 9 over 3 steps, as you found.", rung: null, missClass: null, retest: false }),
			{ tool_calls: [pose("2", "graph-a-line", "(a) (0, -3). (b) (2, 1). (c) No: 2 times 3 minus 3 is 3.")] },
		],
	},
	{ is: topic(WRITTEN_TOPIC), replies: [WRITTEN_REPLY] },
	...STUDIED_TOPICS.map((title) => ({ is: topic(title), replies: shortLesson(true) })),
	...OPEN_TOPICS.map((title) => ({ is: topic(title), replies: shortLesson(false) })),
	{ is: topic(TWO_SHEETS_TOPIC), replies: sheetLesson(false) },
	{ is: topic(ASKED_FIRST_TOPIC), replies: sheetLesson(true) },
	{ is: topic(CODE_CHOICES_TOPIC), replies: [plan(), asking("Here is the function from your notes, written four ways.", "quiz", CODE_QUIZ)] },
	{ is: topic(CODE_WRITE_TOPIC), replies: [plan(), asking("You picked the right version before. Now write it yourself.", "write_code", CODE_WRITE)] },
	{
		is: topic(PROBLEM_FIRST_TOPIC),
		replies: [asking("", "plan_init", { mermaid: TWO_STEPS }), asking("", "problem", { nodeId: "first-step", statement: PROBLEM_FIRST, mode: "recall", modelSolution: "(a) (11 - 2) / (4 - 1) = 3. (b) 2 = 3(1) + b, so b = -1: y = 3x - 1." })],
	},
	{
		is: topic(LONG_PROBLEM_TOPIC),
		replies: [plan(), asking("Try this one.", "problem", { nodeId: "first-step", statement: LONG_PROBLEM, mode: "composition", modelSolution: "2.75x + 2.25(x + 15) = 300, so 5x = 266.25 and x = 53.25: 53.25 and 68.25 miles an hour." })],
	},
	{ is: topic(EXPLAINED_TOPIC), replies: [plan(), say(EXPLAINED)] },
	{
		is: topic(CONCLUDED_TOPIC),
		replies: [
			plan(),
			asking("Try this one.", "problem", STEP_PROBLEM),
			asking("", "conclude", { outcome: "solved", verdict: "x = 4, and your check holds: both sides are 14.", rung: null, missClass: null, retest: false }),
			asking("", "topic_done", { nodeId: "first-step" }),
		],
	},
	{ is: topic(SKIPPED_TOPIC), replies: [plan(), asking("Try this one.", "quiz", quiz("first-step")), say("Here it is worked through: divide both sides of $3x = 12$ by 3, and $x = 4$.")] },
	{ is: topic(DISCARDED_TOPIC), replies: [plan(), asking("Try this one.", "problem", STEP_PROBLEM)] },
	{ is: topic(LAST_TOPIC), replies: [plan(ONE_STEP), asking("Put your answer back into the equation to check it.", "quiz", quiz("only-step")), asking("", "topic_done", { nodeId: "only-step" })] },
	{ is: topic(SHEETLESS_TOPIC), replies: [say("A pull request asks to merge one branch into another.")] },
	{ is: topic(WAITING_TOPIC), holds: true },
];
