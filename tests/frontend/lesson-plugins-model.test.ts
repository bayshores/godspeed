/** What a plugin reads in a lesson, and which plugins show in lessons and spaces. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lessonPluginContext } from "../../src/frontend/components/lesson/lesson-plugins-model.ts";
import { pluginsAt } from "../../src/frontend/lib/use-plugins-at.ts";
import type { InstalledPlugin, PluginManifest } from "../../src/frontend/lib/plugins-api.ts";
import type { LhViewMessage, LhViewPart } from "../../src/shared/core/view.ts";
import type { QuestionAnswerData } from "../../src/shared/core/question-data.ts";

const space = { id: "c21", name: "CSE 21" };
const teacher = (text: string, ...parts: LhViewPart[]): LhViewMessage => ({ id: `m-${text}`, role: "assistant", parts: [{ type: "text", text }, ...parts] });
const OPTIONS = [{ label: "Add", value: "a" }, { label: "Subtract", value: "s" }];
const quiz = (id: string, question: string) => ({ toolCallId: id, input: { question, options: OPTIONS, correctAnswer: "s", explanation: "Undo the plus first." } });
/** An answered question's part, as the lesson's record holds it. */
const answered = (id: string, tool: string, output: Partial<QuestionAnswerData>, input: unknown = quiz(id, "What first?").input): LhViewPart => ({
	type: `tool-${tool}`,
	toolCallId: id,
	state: "output-available",
	input,
	output: { kind: "quiz", questionText: "What first?", dontKnow: false, answers: [], answeredAt: "2026-11-14T10:00:00Z", ...output },
});
const graded = (id: string, correct: boolean, extra: Partial<QuestionAnswerData> = {}) =>
	answered(id, "quiz", { options: [{ index: 1, label: "Add" }, { index: 2, label: "Subtract" }], answers: [{ index: correct ? 2 : 1, label: correct ? "Subtract" : "Add", value: correct ? "s" : "a" }], correctIndices: [2], correct, ...extra });
const lesson = (over: Partial<Parameters<typeof lessonPluginContext>[0]> = {}) =>
	lessonPluginContext({ space, title: "Linear equations", messages: [teacher("Try this one.")], pending: null, ...over });

describe("a plugin's context in a lesson", () => {
	it("with no questions: the space, the title and the teacher's last message", () => {
		const context = lesson({ messages: [teacher("First."), { id: "u", role: "user", parts: [{ type: "text", text: "ok" }] }, teacher("Second.")] });
		assert.deepEqual(context, { space, topic: "Linear equations", question: null, lastAnswered: null, teacherMessage: "Second." });
	});
	it("has no teacher message before the teacher wrote, or when the last one has no text", () => {
		assert.equal(lesson({ messages: [] }).teacherMessage, null);
		assert.equal(lesson({ messages: [{ id: "m", role: "assistant", parts: [{ type: "tool-quiz", toolCallId: "q" }] }] }).teacherMessage, null);
	});
	it("an open question only: its id, text and option labels, never the answer, and nothing answered yet", () => {
		const context = lesson({ pending: quiz("q1", "What do you undo first?") });
		assert.deepEqual(context.question, { id: "q1", text: "What do you undo first?", options: ["Add", "Subtract"] });
		assert.equal(context.lastAnswered, null);
		assert.doesNotMatch(JSON.stringify(context), /Undo the plus|"s"/);
	});
	it("a question the learner writes in words has no options; a broken one is left out", () => {
		assert.deepEqual(lesson({ pending: { toolCallId: "e1", input: { question: "Why?", correctAnswer: "Because." } } }).question, { id: "e1", text: "Why?", options: [] });
		assert.equal(lesson({ pending: { toolCallId: "q1", input: null } }).question, null);
		assert.equal(lesson({ pending: { toolCallId: "q1", input: { options: [] } } }).question, null);
	});
	it("answered, then a new open question: the new one has no answer, the answered one has its answer and the verdict the card shows", () => {
		const context = lesson({ messages: [teacher("Try this one.", graded("q1", false)), teacher("Next.")], pending: quiz("q2", "And then?") });
		assert.deepEqual(context.question, { id: "q2", text: "And then?", options: ["Add", "Subtract"] });
		assert.deepEqual(context.lastAnswered, { id: "q1", text: "What first?", options: ["Add", "Subtract"], answer: "Subtract", correct: false });
	});
	it("the most recent answer wins", () => {
		const context = lesson({ messages: [teacher("One.", graded("q1", false)), teacher("Two.", graded("q2", true))] });
		assert.equal(context.lastAnswered?.id, "q2");
		assert.equal(context.lastAnswered?.correct, true);
	});
	it("answered with no right answer: an ask, or code, has neither answer nor verdict", () => {
		const ask = answered("a1", "ask_user_question", { kind: "ask", questionText: "Which do you like?", options: [{ index: 1, label: "Add" }] }, { question: "Which do you like?", options: [{ label: "Add" }] });
		assert.deepEqual(lesson({ messages: [teacher("Pick.", ask)] }).lastAnswered, { id: "a1", text: "Which do you like?", options: ["Add"] });
		const code = answered("c1", "write_code", { kind: "code", questionText: "Write it.", code: "x = 1" }, { question: "Write it." });
		assert.deepEqual(lesson({ messages: [teacher("Code.", code)] }).lastAnswered, { id: "c1", text: "Write it.", options: [] });
	});
	it("an explain question's committed answer is its answer; it is never graded on the card", () => {
		const explain = answered("e1", "explain", { kind: "explain", questionText: "Why?", text: "Because." }, { question: "Why?", correctAnswer: "To undo the plus." });
		assert.deepEqual(lesson({ messages: [teacher("Explain.", explain)] }).lastAnswered, { id: "e1", text: "Why?", options: [], answer: "To undo the plus." });
	});
	it("no verdict where the card shows none: a prediction or I don't know; a skipped question has neither answer nor verdict", () => {
		const prediction = graded("p1", true, { questionType: "predict" });
		assert.ok(!("correct" in lesson({ messages: [teacher("Guess.", prediction)] }).lastAnswered!));
		const dontKnow = graded("d1", false, { dontKnow: true, answers: [] });
		assert.deepEqual(lesson({ messages: [teacher("Q.", dontKnow)] }).lastAnswered, { id: "d1", text: "What first?", options: ["Add", "Subtract"], answer: "Subtract" });
		const skipped = answered("s1", "quiz", { dismissed: true, correctIndices: [2], correct: false });
		assert.deepEqual(lesson({ messages: [teacher("Q.", skipped)] }).lastAnswered, { id: "s1", text: "What first?", options: [] });
	});
});

const manifest = (over: Partial<PluginManifest> = {}): PluginManifest => ({
	id: "memes",
	name: "Memes",
	version: "1.0.0",
	description: "A meme.",
	author: "x",
	entry: "index.html",
	settings: [],
	network: [],
	uses: [],
	...over,
});
const installed = (m: PluginManifest, enabled = true): InstalledPlugin => ({ id: m.id, folder: `/p/${m.id}`, manifest: m, enabled, values: { n: 1 } });

describe("the plugins shown in a place", () => {
	const all: InstalledPlugin[] = [
		installed(manifest({ lesson: { label: "Memes" } })),
		installed(manifest({ id: "cards", name: "Flashcards", space: { label: "Cards" } })),
		installed(manifest({ id: "off", lesson: { label: "Off" } }), false),
		installed(manifest({ id: "both", name: "Both", lesson: { label: "Both" }, space: { label: "Both tab" } })),
		{ id: "broken", folder: "/p/broken", error: "No manifest." },
	];
	it("lists the ones that are on and have a lesson label, in order", () => {
		assert.deepEqual(pluginsAt(all, "lesson").map((p) => [p.id, p.label]), [["memes", "Memes"], ["both", "Both"]]);
	});
	it("lists the ones that are on and have a space label, in order", () => {
		assert.deepEqual(pluginsAt(all, "space").map((p) => [p.id, p.label, p.name]), [["cards", "Cards", "Flashcards"], ["both", "Both tab", "Both"]]);
	});
	it("carries the manifest and the setting values for the frame", () => {
		const [first] = pluginsAt(all, "lesson");
		assert.equal(first!.manifest.entry, "index.html");
		assert.deepEqual(first!.values, { n: 1 });
	});
});
