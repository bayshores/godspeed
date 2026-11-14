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

/** A plot of measured points alone and its stored result (made up). */
export const CV_CALL = {
	title: "Cross-validation error by degree",
	x: { name: "degree", label: "polynomial degree", min: 0, max: 10 },
	y: { label: "CV error" },
	lines: [{ label: "cv_error", points: [[1, 0.8], [3, 0.4], [5, 0.3], [9, 0.9]] }],
};

export const CV_RESULT = { part: "plot", v: 1, id: "p1", onPlot: { toolCallId: "call_q", value: 0.3 }, y: { min: 0.2, max: 1 } };
