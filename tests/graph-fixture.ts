/**
 * A small ProgressPayload for the topic Graph's tests: five topics in
 * three columns, one deadline (an exam) covering three of them.
 */
import {
	rampColor,
	tally,
	topicStatus,
	type AnswerOutcome,
	type AnswerRef,
	type ConfidenceLevel,
	type FactProgress,
	type ProgressPayload,
	type TopicProgress,
} from "../src/core/index.ts";

let seq = 0;
export function answers(spec: string, level?: ConfidenceLevel): AnswerRef[] {
	// r = right, w = wrong, d = don't know
	return [...spec].map((c) => {
		const outcome: AnswerOutcome = c === "r" ? "right" : c === "w" ? "wrong" : "dontKnow";
		seq++;
		return {
			chatId: "chat-1",
			toolCallId: `call-${seq}`,
			outcome,
			...(level && outcome !== "dontKnow" ? { level } : {}),
			answeredAt: `2026-10-${String(10 + (seq % 15)).padStart(2, "0")}T00:00:00Z`,
		};
	});
}

export function topic(id: string, name: string, column: number, members: string[], refs: AnswerRef[], overconfident = false): TopicProgress {
	const t = tally(refs);
	return {
		id,
		name,
		members,
		...t,
		status: topicStatus(t.rate),
		color: rampColor(t.rate),
		overconfident,
		answers: refs,
		column,
	};
}

export function fact(id: string, topicId: string, name: string, refs: AnswerRef[] = []): FactProgress {
	return { id, name, statement: `${name} — the statement.`, topicId, born: "chat-1", inLessons: true, answers: refs };
}

export function fixture(): ProgressPayload {
	const topics = [
		topic("t-deriv", "Derivatives", 0, ["f1", "f2"], answers("rrrrr")),
		topic("t-var", "Variance", 0, ["f3", "f4"], answers("rrrrwww")),
		topic("t-mini", "Minibatch noise", 1, ["f5", "f6", "f7", "f8", "f9", "f10"], answers("rrrwwww", 5), true),
		topic("t-mom", "Momentum", 2, ["f11"], []),
		topic("t-attn", "Attention", 2, ["f12"], answers("rr")),
	];
	const facts = [
		fact("f1", "t-deriv", "Chain rule"),
		fact("f2", "t-deriv", "Product rule"),
		fact("f3", "t-var", "Variance adds"),
		fact("f4", "t-var", "Variance scales"),
		fact("f5", "t-mini", "Minibatch gradient is unbiased", answers("w")),
		fact("f6", "t-mini", "Noise variance shrinks like $1/B$", answers("rw")),
		fact("f7", "t-mini", "Bigger batches cost more per step", answers("r")),
		fact("f8", "t-mini", "Noise can help escape flat regions"),
		fact("f9", "t-mini", "Batch size and learning rate", answers("d")),
		fact("f10", "t-mini", "Gradient noise scale"),
		fact("f11", "t-mom", "Momentum averages steps"),
		fact("f12", "t-attn", "Attention weights sum to one"),
	];
	return {
		classId: "cls-1",
		today: "2026-10-27",
		topicsAt: "2026-10-26T00:00:00Z",
		grouping: false,
		topics,
		topicLinks: [
			{ from: "t-deriv", to: "t-mini", weight: 2 },
			{ from: "t-var", to: "t-mini", weight: 3 },
			{ from: "t-mini", to: "t-mom", weight: 1 },
		],
		facts,
		files: [],
		nextUp: null,
		lessons: [],
		calibration: { levels: [], sureButWrong: [] },
		deadlines: [
			{
				id: "ex-1",
				kind: "exam",
				name: "Midterm 1",
				date: "2026-11-05",
				done: false,
				daysUntil: 9,
				files: [
					{ id: "file-1", name: "Lecture 1" },
					{ id: "file-2", name: "Lecture 2" },
				],
				topicIds: ["t-var", "t-mini", "t-mom"],
				counts: { strong: 0, shaky: 1, weak: 1, untested: 1 },
				workOnNext: [
					{ topicId: "t-var", name: "Variance", status: "shaky", reason: "Minibatch noise builds on it, so fix it first" },
					{ topicId: "t-mini", name: "Minibatch noise", status: "weak", reason: "overconfident" },
					{ topicId: "t-mom", name: "Momentum", status: "untested", reason: "Due soon, never practiced" },
				],
				ready: 0.3,
				topics: [
					{ id: "t-mom", name: "Momentum", rate: null },
					{ id: "t-mini", name: "Minibatch noise", rate: 3 / 7 },
					{ id: "t-var", name: "Variance", rate: 4 / 7 },
				],
			},
		],
		overall: {
			topicIds: topics.map((t) => t.id),
			counts: { strong: 2, shaky: 1, weak: 1, untested: 1 },
			workOnNext: [{ topicId: "t-mini", name: "Minibatch noise", status: "weak", reason: "overconfident" }],
		},
		totals: { answered: 21, right: 14, wrong: 7, dontKnow: 0, rate: 14 / 21 },
	};
}
