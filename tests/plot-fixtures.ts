/** Screen 05's plot and its stored result, as the teacher sends them (made up). */
export const LEASH_CALL = {
	title: "One feature, where the weight ends up",
	x: { name: "a", label: "where the data alone put it, $a$", min: 0, max: 10 },
	y: { label: "$w$" },
	slider: { name: "lambda", min: 0.5, max: 4, start: 1 },
	lines: [
		{ label: "penalty", expr: "a/(1+lambda)", hidden: true },
		{ label: "leash", expr: "min(a, 4/(1+lambda))" },
	],
};

export const LEASH_RESULT = { part: "plot", v: 1, id: "p1", onPlot: { toolCallId: "call_q", value: 4 }, y: { min: 0, max: 5 } };

/** Screen 05's guess on that plot. */
export const LEASH_GUESS = {
	type: "predict",
	nodeId: "reg",
	question: "Now the data pull twice as hard, $a = 8$, still at $\\lambda = 1$. Where does the penalty put it?",
	options: [{ label: "At 2, the leash's length." }, { label: "At 4." }, { label: "At 3." }, { label: "At 8." }],
	correctAnswer: "At 4.",
	explanation: "Made up for the test.",
	onPlot: { line: "penalty", x: 8 },
};
