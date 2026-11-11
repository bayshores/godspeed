// The lesson-record rules: the folds over a message list, the model-facing conversion, the
// constructors, the input events and the attachment rules. Ids and clock stamps the constructors
// make are masked (see `norm`); everything else must match byte for byte.
import {
	concludedByDismissalPair,
	activeProblemOf,
	classCardText,
	danglingQuestionOf,
	endsInDismissal,
	failedOutputCallIds,
	hasProbeDone,
	isSideTurn,
	newAnswerResult,
	newAppRequestMessage,
	newClassContextMessage,
	newGraphContextMessage,
	newHandoffMessage,
	newNextMessage,
	newPlanBlockMessage,
	newProblemDismissedMarker,
	newSideQuestion,
	newStudyContextMessage,
	newThinkingMessage,
	newTodayContextMessage,
	newUserMessage,
	newUserSteer,
	pendingProblemDismissalOf,
	problemInputForConclude,
	retryContext,
	sendToUserText,
	sideHeldQuestions,
	toLlmMessages,
	userFacingTextOf,
} from "../../../../src/shared/core/native-messages.ts";
import {
	attachmentRefusal,
	base64Bytes,
	contentText,
	keepsPng,
	pdfFileName,
	pdfNote,
	pdfNoteOf,
} from "../../../../src/shared/core/attachments.ts";
import {
	dismissAppends,
	inputAppends,
	parseChatInput,
	parseDismissInput,
	parseUserSteerInput,
} from "../../../../src/shared/core/input-events.ts";
import { firstPhase, phaseAt3Lh } from "../../../../src/shared/core/phases.ts";

/** Masks what a constructor stamps from the clock or the id generator. */
function norm(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(norm);
	if (value === null || typeof value !== "object") return value;
	const out: Record<string, unknown> = {};
	for (const [key, v] of Object.entries(value)) {
		if (key === "timestamp" && typeof v === "number") out[key] = 0;
		else if (key === "id" && typeof v === "string" && /^(msg|pb)_[0-9a-z]+_[0-9a-f]{8}$/.test(v)) out[key] = "<id>";
		else out[key] = norm(v);
	}
	return out;
}

/** Runs `run`, keeping a refusal as data: the message the HTTP route would answer with. */
function outcome(run: () => unknown): unknown {
	try {
		return { ok: norm(run()) ?? null };
	} catch (err) {
		return { error: (err as Error).message };
	}
}

// ─── record fixtures ─────────────────────────────────────────────────────────

const call = (id: string, name: string, args: unknown = {}) => ({ type: "toolCall", id, name, arguments: args });
const text = (t: string) => ({ type: "text", text: t });
const assistant = (id: string, content: unknown[], stopReason = "toolUse") => ({ id, role: "assistant", content, api: "faux", provider: "p", model: "m", stopReason, timestamp: 1 });
const result = (id: string, toolCallId: string, toolName: string, extra: Record<string, unknown> = {}) => ({
	id, role: "toolResult", toolCallId, toolName, content: [text("ok")], isError: false, timestamp: 2, ...extra,
});
const user = (id: string, t: string, extra: Record<string, unknown> = {}) => ({ id, role: "user", content: t, timestamp: 3, ...extra });
const side = (id: string, t: string) => user(id, t, { side: true });
const custom = (id: string, customType: string, details: unknown = {}, extra: Record<string, unknown> = {}) => ({
	id, role: "custom", customType, content: `marker ${customType}`, display: true, details, timestamp: 4, ...extra,
});
const answered = (id: string, callId: string, toolName: string, details: unknown = { kind: "quiz" }) => result(id, callId, toolName, { details });

const quizArgs = { nodeId: "n1", question: "q?" };
const image = { type: "image", data: "QUJD", mimeType: "image/png" };

const histories: Record<string, unknown[]> = {
	empty: [],
	opening: [user("u1", "hello")],
	question_open: [user("u1", "hi"), assistant("a1", [text("ok"), call("q1", "quiz", quizArgs)])],
	question_answered: [user("u1", "hi"), assistant("a1", [call("q1", "quiz", quizArgs)]), answered("r1", "q1", "quiz"), assistant("a2", [text("next")], "stop")],
	two_questions: [assistant("a1", [call("q1", "quiz", quizArgs), call("q2", "explain", { prompt: "why" })]), answered("r1", "q1", "quiz")],
	other_tool_open: [assistant("a1", [call("t1", "read", { path: "x" })])],
	learner_closes_question: [assistant("a1", [call("q1", "quiz", quizArgs)]), user("u2", "never mind")],
	probe_asked: [assistant("a1", [call("p1", "probe", {})]), answered("r1", "p1", "probe")],
	probe_done: [
		assistant("a1", [call("d1", "probe_done", {})]),
		result("r1", "d1", "probe_done", { details: { ok: true } }),
	],
	probe_done_refused: [assistant("a1", [call("d1", "probe_done", {})]), result("r1", "d1", "probe_done", { details: { ok: false } })],
	probe_done_errored: [assistant("a1", [call("d1", "probe_done", {})]), result("r1", "d1", "probe_done", { isError: true })],
	teaching: [
		assistant("a1", [call("d1", "probe_done", {})]),
		result("r1", "d1", "probe_done"),
		assistant("a2", [call("q1", "quiz", { question: "untagged" })]),
		answered("r2", "q1", "quiz"),
		assistant("a3", [call("q2", "explain", { nodeId: "n2" })]),
	],
	side_around_question: [
		assistant("a1", [text("hmm"), call("q1", "quiz", quizArgs)]),
		custom("c1", "plan-block"),
		side("s1", "quick one"),
		assistant("a2", [text("answer")], "stop"),
	],
	side_then_answer: [
		assistant("a1", [call("q1", "quiz", quizArgs)]),
		side("s1", "quick one"),
		assistant("a2", [text("answer")], "stop"),
		answered("r1", "q1", "quiz", { kind: "quiz", picked: 2 }),
	],
	side_with_image: [assistant("a1", [call("q1", "explain", {})]), side("s1", "see this"), answered("r1", "q1", "explain", { kind: "explain" })].map((m) => ((m as { id: string }).id === "s1" ? { ...(m as object), content: [text("see this"), image] } : m)),
	problem_active: [
		assistant("a1", [call("p1", "problem", { statement: "Solve", mode: "work", target: ["x"], modelSolution: "42" })]),
		result("r1", "p1", "problem"),
	],
	problem_unacked: [assistant("a1", [call("p1", "problem", { statement: "Solve" })])],
	problem_errored: [assistant("a1", [call("p1", "problem", {})]), result("r1", "p1", "problem", { isError: true })],
	problem_concluded: [
		assistant("a1", [call("p1", "problem", { statement: "Solve" })]),
		result("r1", "p1", "problem"),
		assistant("a2", [call("k1", "conclude", { outcome: "solved" })]),
		result("r2", "k1", "conclude"),
	],
	problem_conclude_errored: [
		assistant("a1", [call("p1", "problem", { statement: "Solve" })]),
		result("r1", "p1", "problem"),
		assistant("a2", [call("k1", "conclude", {})]),
		result("r2", "k1", "conclude", { isError: true }),
	],
	problem_dismissed: [
		assistant("a1", [call("p1", "problem", { statement: "Solve" })]),
		result("r1", "p1", "problem"),
		custom("c1", "problem-dismissed", { problemCallId: "p1" }),
	],
	problem_dismissed_then_concluded: [
		assistant("a1", [call("p1", "problem", {})]),
		result("r1", "p1", "problem"),
		custom("c1", "problem-dismissed", { problemCallId: "p1" }),
		// Fixed ids and stamps, so the recorded history is the same on every run.
		...concludedByDismissalPair("p1").map((m, i) => ({ ...m, id: `pair${i}`, timestamp: 5 })),
	],
	problem_dismissed_then_new_problem: [
		assistant("a1", [call("p1", "problem", {})]),
		result("r1", "p1", "problem"),
		custom("c1", "problem-dismissed", { problemCallId: "p1" }),
		assistant("a2", [call("p2", "problem", { statement: "Again" })]),
		result("r2", "p2", "problem"),
	],
	side_around_problem: [
		assistant("a1", [call("p1", "problem", { statement: "Solve" })]),
		result("r1", "p1", "problem"),
		side("s1", "what does that symbol mean?"),
		assistant("a2", [text("it means")], "stop"),
		side("s2", "and this one?"),
	],
	side_around_problem_parts: [
		assistant("a1", [call("p1", "problem", {})]),
		result("r1", "p1", "problem"),
		{ ...side("s1", ""), content: [image, text("caption")] },
		{ ...side("s2", ""), content: [image] },
	],
	dismissed_question: [assistant("a1", [call("q1", "quiz", quizArgs)]), answered("r1", "q1", "quiz", { kind: "quiz", dismissed: true })],
	trailing_failures: [user("u1", "go"), assistant("a1", [text("partial")], "error"), assistant("a2", [], "aborted")],
	trailing_stop: [user("u1", "go"), assistant("a1", [text("done")], "stop")],
	send_to_user: [
		assistant("a1", [call("s1", "send_to_user", { message: "hello there" }), call("s2", "send_to_user", { message: "bad" }), text("plain")]),
		result("r1", "s1", "send_to_user"),
		result("r2", "s2", "send_to_user", { isError: true }),
	],
	side_around_two_questions: [
		assistant("a1", [call("q1", "quiz", { question: 'say "hi" — ok' }), call("q2", "explain", { question: "é \ud800 😀" })]),
		side("s1", "wait"),
		assistant("a2", [text("sure")], "stop"),
		answered("r1", "q1", "quiz"),
		answered("r2", "q2", "explain", { kind: "explain" }),
	],
	compacted: [
		user("u0", "old one"),
		assistant("a0", [text("old reply")], "stop"),
		custom("c1", "compaction", { firstKeptMessageId: "u1" }, { content: "[Summary] earlier talk" }),
		user("u1", "kept"),
		assistant("a1", [text("kept reply")], "stop"),
	],
	compaction_names_missing_id: [user("u0", "one"), custom("c1", "compaction", { firstKeptMessageId: "gone" }, { content: "[Summary]" }), user("u1", "two")],
	markers: [
		custom("m1", "class-context", { classId: "c" }, { content: "[Class context] x" }),
		custom("m2", "today-context", { day: "2026-11-10" }, { display: false, content: "[Today] it is Tuesday" }),
		custom("m3", "practice-thinking", { problemCallId: "p1", text: "t" }, { attachments: [image] }),
		custom("m4", "plan-block", { planCallId: "x" }),
		custom("m5", "app-request", { deadlines: [] }),
		user("u1", "hi", { content: [text("with picture"), image] }),
		{ id: "sys", role: "bogus", stuff: 1 },
	],
	system_first: [{ role: "system", content: "chrome" }, user("u1", "hi"), assistant("a1", [call("q1", "quiz", quizArgs)])],
	dangling_calls: [
		assistant("a1", [call("q1", "quiz", quizArgs), call("t1", "read", {})]),
		user("u2", "stop"),
		assistant("a2", [call("t1", "read", {}), call("t1", "read", {})]),
		result("r2", "t1", "read"),
	],
};

function foldsOf(messages: unknown[]) {
	const m = messages as never[];
	const concludeIds = m.flatMap((x) => ((x as { role?: string }).role === "assistant" ? ((x as { content: { type: string; id: string; name: string }[] }).content.filter((b) => b.type === "toolCall" && b.name === "conclude").map((b) => b.id)) : []));
	return {
		active: activeProblemOf(m),
		dangling: danglingQuestionOf(m),
		endsInDismissal: endsInDismissal(m),
		hasProbeDone: hasProbeDone(m),
		pendingDismissal: pendingProblemDismissalOf(m),
		retry: retryContext(m).map((x) => x.id),
		phases: ["probe", "plan", "teach"].map((start) => phaseAt3Lh(m, start as never)),
		failed: [...failedOutputCallIds(m)].sort(),
		sideTurn: isSideTurn(m),
		held: [...sideHeldQuestions(m).entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
		concludeInputs: concludeIds.map((id) => problemInputForConclude(m, id) ?? null),
		missingConclude: problemInputForConclude(m, "nope") ?? null,
		llm: toLlmMessages(m),
	};
}

// ─── input events ────────────────────────────────────────────────────────────

const file = (name: string, mimeType: string, data: string) => ({ name, mimeType, data });
const png = file("a.png", "image/png", "QUJD");

const chatInputs: unknown[] = [
	null, "x", 5, [], {}, { type: 5 }, { type: "nope" }, { type: undefined },
	{ type: "text", text: "hi" }, { type: "text", text: "  " }, { type: "text", text: 5 }, { type: "text" },
	{ type: "text", text: " ", attachments: [png] }, { type: "text", text: "x", attachments: [] }, { type: "text", text: "x", attachments: "no" },
	{ type: "text", text: "x", attachments: [png, png, png, png, png, png] }, { type: "text", text: "x", attachments: [null] },
	{ type: "text", text: "x", attachments: [{ name: " ", mimeType: "image/png", data: "QUJD" }] },
	{ type: "text", text: "x", attachments: [{ name: "a", mimeType: "", data: "QUJD" }] },
	{ type: "text", text: "x", attachments: [file("a.png", "image/png", "QUJ")] },
	{ type: "text", text: "x", attachments: [file("a.png", "image/png", "QU=D")] },
	{ type: "text", text: "x", attachments: [file("a.png", "image/png", "")] },
	{ type: "text", text: "x", attachments: [file("a.heic", "", "QUJD")] },
	{ type: "text", text: "x", attachments: [file("a.txt", "text/plain", "QUJD")] },
	{ type: "text", text: "x", attachments: [file("notes.pdf", "application/pdf", "QUJD"), file("b.jpg", "", "QQ==")] },
	{ type: "answer", toolCallId: "q1", answer: { kind: "quiz" } }, { type: "answer", toolCallId: "", answer: {} },
	{ type: "answer", toolCallId: "q1" }, { type: "answer", toolCallId: "q1", answer: null }, { type: "answer", toolCallId: "q1", answer: [] },
	{ type: "answer", toolCallId: "q1", answer: { kind: "explain" }, attachments: [png] },
	{ type: "continue" }, { type: "continue", extra: 1 },
	{ type: "side", text: "why" }, { type: "side", text: "" }, { type: "side", text: "", attachments: [png] },
	{ type: "thinking", problemCallId: "p1", text: "idea" }, { type: "thinking", problemCallId: "", text: "x" },
	{ type: "thinking", problemCallId: "p1", text: " " }, { type: "thinking", problemCallId: "p1", text: "", attachments: [png] },
	{ type: "next" },
];

const dismissInputs: unknown[] = [
	null, 4, {}, { type: "steer" },
	{ type: "dismiss", toolCallId: "q1", answer: { kind: "quiz", dismissed: true } },
	{ type: "dismiss", toolCallId: "", answer: { dismissed: true } }, { type: "dismiss", answer: { dismissed: true } },
	{ type: "dismiss", toolCallId: "q1" }, { type: "dismiss", toolCallId: "q1", answer: null },
	{ type: "dismiss", toolCallId: "q1", answer: { kind: "quiz" } }, { type: "dismiss", toolCallId: "q1", answer: { dismissed: "yes" } },
	{ type: "dismiss", toolCallId: "q1", answer: { kind: "explain", dismissed: true } },
	{ type: "dismiss-problem", problemCallId: "p1" }, { type: "dismiss-problem", problemCallId: "" }, { type: "dismiss-problem" },
];

const steerInputs: unknown[] = [
	null, {}, { type: "text" }, { type: "steer" }, { type: "steer", id: "", text: "x" }, { type: "steer", id: "s1" },
	{ type: "steer", id: "s1", text: "  " }, { type: "steer", id: "s1", text: 5 }, { type: "steer", id: "s1", text: " go " },
];

const records: Record<string, { kind?: string; messages: unknown[] }> = {
	empty: { messages: [] },
	question: { messages: histories.question_open! },
	explain_question: { messages: [assistant("a1", [call("q1", "explain", {})])] },
	code_question: { messages: [assistant("a1", [call("q1", "write_code", {})])] },
	problem: { kind: "study", messages: histories.problem_active! },
	dismissed_problem: { kind: "practice", messages: histories.problem_dismissed! },
	between_problems: { kind: "homework", messages: histories.problem_concluded! },
	teach: { kind: "teach", messages: histories.problem_concluded! },
};

const answerInputs: unknown[] = [
	{ type: "answer", toolCallId: "q1", answer: { kind: "quiz", picked: 1 } },
	{ type: "answer", toolCallId: "q1", answer: { kind: "explain", text: "because" } },
	{ type: "answer", toolCallId: "other", answer: { kind: "quiz" } },
];

function appendCases(): unknown[] {
	const out: unknown[] = [];
	const inputs = [
		// A kind-less answer is the question rules' own case, not the record's.
		...chatInputs.filter((raw) => !Array.isArray((raw as { answer?: unknown } | null)?.answer)),
		...answerInputs,
		{ type: "thinking", problemCallId: "p1", text: "idea" },
		{ type: "thinking", problemCallId: "p2", text: "idea" },
	];
	for (const [recordName, record] of Object.entries(records)) {
		for (const raw of inputs) {
			let parsed: ReturnType<typeof parseChatInput>;
			try {
				parsed = parseChatInput(raw);
			} catch {
				continue;
			}
			const stored = ("attachments" in parsed ? (parsed.attachments ?? []) : []).map((a) => ({ type: "text", text: `stored ${a.name}` }));
			out.push({ record: recordName, input: raw, stored, ...(outcome(() => inputAppends(record as never, parsed, stored as never)) as object) });
		}
		for (const raw of dismissInputs) {
			let parsed: ReturnType<typeof parseDismissInput>;
			try {
				parsed = parseDismissInput(raw);
			} catch {
				continue;
			}
			out.push({ record: recordName, dismiss: raw, ...(outcome(() => dismissAppends(record as never, parsed)) as object) });
		}
	}
	return out;
}

// ─── cases ───────────────────────────────────────────────────────────────────

const cards = [
	{ classId: "c1", name: "CSE 21", description: "  My class.  ", files: [], topics: undefined },
	{
		classId: "c2", name: "Math", description: "",
		files: [
			{ name: "notes.pdf", kind: "study", path: "/f/notes.pdf", size: "98 pages", status: "ready" },
			{ name: "syllabus.pdf", kind: "info", path: "/f/syllabus.pdf", status: "reading" },
			{ name: "gone.pdf", kind: "info", path: null },
			{ name: "talk.mp4", kind: "study", path: "/f/talk.txt", size: "52 min", status: "failed" },
		],
		topics: [{ name: "Limits", facts: 4 }, { name: "Series", facts: 0 }],
	},
	{ classId: "c3", name: "Empty topics", description: "d", files: [], topics: [] },
];

export default {
	"folds over saved lessons": () => Object.entries(histories).map(([name, messages]) => ({ name, messages, ...foldsOf(messages) })),
	"first phase": () => [undefined, "teach", "practice", "study", "homework", "talk", ""].map((kind) => ({ kind: kind ?? null, phase: firstPhase(kind) })),
	"user facing text": () => [
		{ text: "plain" },
		[text("a"), call("s1", "send_to_user", { message: "hi" }), call("s2", "send_to_user", { message: "no" }), call("s3", "send_to_user", {}), call("s4", "send_to_user", { message: 5 }), call("s5", "send_to_user", { text: "old shape" }), call("s6", "send_to_user", { message: " \n" }), image],
		[],
		null,
		"string",
	].map((content) => ({ content, all: userFacingTextOf(content as never), failed: userFacingTextOf(content as never, new Set(["s2"])) })),
	"send to user text": () => [null, 4, {}, { type: "text" }, call("x", "other", { text: "t" }), call("x", "send_to_user", {}), call("x", "send_to_user", { text: "  hi " }), call("x", "send_to_user", { message: "" }), call("x", "send_to_user", { message: "  hi " }), call("x", "send_to_user", { message: "\u00a0" }), call("x", "send_to_user", null), { type: "toolCall", name: "send_to_user", arguments: ["hi"] }].map((block) => ({ block, text: sendToUserText(block) ?? null })),
	"new messages": () => [
		["user", newUserMessage("hello", [])],
		["user with files", newUserMessage("hello", [text("[Attached PDF]"), image] as never)],
		["side", newSideQuestion("why?", [])],
		["side with files", newSideQuestion("why?", [image] as never)],
		["steer", newUserSteer("keep going", "steer_1")],
		["answer", newAnswerResult("q1", "quiz", { kind: "quiz", picked: 2 } as never)],
		["answer with files", newAnswerResult("q1", "explain", { kind: "explain", text: "t" } as never, [image] as never)],
		["handoff", newHandoffMessage("chat_abc")],
		["plan block", newPlanBlockMessage("plan_1", { steps: ["a"] } as never)],
		["today", newTodayContextMessage("[Today] Tuesday", "2026-11-10")],
		["app request", newAppRequestMessage("Add the deadlines", [{ id: "d1", title: "Quiz" }] as never)],
		["thinking", newThinkingMessage("p1", "my idea")],
		["thinking with files", newThinkingMessage("p1", "my idea", [image] as never)],
		["next", newNextMessage()],
		["dismissed marker", newProblemDismissedMarker("p1")],
		["dismissal pair", concludedByDismissalPair("p1")],
	].map(([name, built]) => ({ name, built: norm(built) })),
	"context cards": () => [
		...cards.map((card) => ({ card, text: classCardText(card as never), message: norm(newClassContextMessage(card as never)) })),
		{
			picks: [{ id: "p1", name: "Limit", statement: "A limit is" }],
			chains: ["Limit → Continuity"],
			message: norm(newGraphContextMessage([{ id: "p1", name: "Limit", statement: "A limit is" }], ["Limit → Continuity"])),
		},
		{ picks: [], chains: [], message: norm(newGraphContextMessage([], [])) },
		{ study: norm(newStudyContextMessage("[Study] topics")), homework: norm(newStudyContextMessage("[Homework] problems", "homework-context")) },
	],
	"chat inputs": () => chatInputs.map((raw) => ({ raw, ...(outcome(() => parseChatInput(raw)) as object) })),
	"dismiss inputs": () => dismissInputs.map((raw) => ({ raw, ...(outcome(() => parseDismissInput(raw)) as object) })),
	"steer inputs": () => steerInputs.map((raw) => ({ raw, ...(outcome(() => parseUserSteerInput(raw)) as object) })),
	"appends for inputs": () => ({ records, cases: appendCases() }),
	"attachment rules": () => ({
		refusals: [
			["a.png", "", 1], ["a.PNG", "", 1], ["a.jpeg", "", 1], ["a.heic", "", 1], ["a.HEIF", "", 1], ["photo", "image/heic", 1], ["a.txt", "", 1],
			["a.pdf", "", 30 * 1024 * 1024], ["a.pdf", "", 30 * 1024 * 1024 + 1], ["p", "image/png", 20 * 1024 * 1024],
			["p", "image/png", 20 * 1024 * 1024 + 1], ["x.tar.gz", "", 1], ["x.", "", 1], ["noext", "", 1], ["a.webp", "application/pdf", 1],
			["a.pdf", "text/plain", 1], [".png", "", 1],
		].map(([name, type, size]) => ({ name, type, size, refusal: attachmentRefusal({ name: name as string, type: type as string, size: size as number }) })),
		base64: ["", "QUJD", "QUI=", "QQ==", "QQ=", "====", "QUJDRA=="].map((data) => ({ data, bytes: base64Bytes(data) })),
		png: [[true, false, 9e9], [false, true, 1.5 * 1024 * 1024], [false, true, 1.5 * 1024 * 1024 + 1], [false, false, 1]].map(([transparent, sourcePng, pngBytes]) => ({ transparent, sourcePng, pngBytes, keeps: keepsPng({ transparent: transparent as boolean, sourcePng: sourcePng as boolean, pngBytes: pngBytes as number }) })),
		pdfNames: [
			["../My Notes (v2).PDF", "0123456789abcdef"], ["...pdf", "ab"], ["x".repeat(100), "h"], ["  .hidden.pdf", "1234"], ["résumé 日本語.pdf", "abcdef0123456789"], ["", "z"], ["a  b\tc.pdf", "q"],
		].map(([name, hash]) => ({ name, hash, file: pdfFileName(name!, hash!) })),
		notes: [["my   file.pdf", "/tmp/a.pdf"], ["tab\tname\n.pdf", "/x y/z.pdf"]].map(([name, path]) => {
			const note = pdfNote(name!, path!);
			return { name, path, note, back: pdfNoteOf(note.text) };
		}),
		notesBack: ["[Attached PDF] x\nPath: y", "random", "[Attached PDF] x\nPath: y\nRead it with the pdf tool when you need its content.", "[Attached PDF] a\nPath: \nRead it with the pdf tool when you need its content.", "Attached PDF x\nPath: y\nRead it with the pdf tool when you need its content."].map((t) => ({ t, back: pdfNoteOf(t) })),
		contentText: ["plain", [text("a"), image], [image], [], [{ type: "text" }]].map((content) => ({ content, text: contentText(content as never) })),
	}),
} as Record<string, () => unknown>;
