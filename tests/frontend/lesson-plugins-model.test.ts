/** What a plugin reads in a lesson, and which plugins show in lessons and spaces. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lessonPluginContext } from "../../src/frontend/components/lesson/lesson-plugins-model.ts";
import { pluginsAt } from "../../src/frontend/lib/use-plugins-at.ts";
import type { InstalledPlugin, PluginManifest } from "../../src/frontend/lib/plugins-api.ts";
import type { LhViewMessage } from "../../src/shared/core/view.ts";

const space = { id: "c21", name: "CSE 21" };
const teacher = (text: string): LhViewMessage => ({ id: "m1", role: "assistant", parts: [{ type: "text", text }] });
const quiz = (id: string, question: string) => ({
	toolCallId: id,
	input: { question, options: [{ label: "Add", value: "a" }, { label: "Subtract", value: "s" }], correctAnswer: "s", explanation: "Undo the plus first." },
});
const lesson = (over: Partial<Parameters<typeof lessonPluginContext>[0]> = {}) =>
	lessonPluginContext({ space, title: "Linear equations", messages: [teacher("Try this one.")], pending: null, requiresReveal: false, ...over });

describe("a plugin's context in a lesson", () => {
	it("names the space, the topic and the teacher's last message", () => {
		const context = lesson({ messages: [teacher("First."), { id: "u", role: "user", parts: [{ type: "text", text: "ok" }] }, teacher("Second.")] });
		assert.deepEqual(context, { space, topic: "Linear equations", question: null, teacherMessage: "Second." });
	});
	it("has no teacher message before the teacher wrote, or when the last one has no text", () => {
		assert.equal(lesson({ messages: [] }).teacherMessage, null);
		assert.equal(lesson({ messages: [{ id: "m", role: "assistant", parts: [{ type: "tool-quiz", toolCallId: "q" }] }] }).teacherMessage, null);
	});
	it("has no question when none is open", () => {
		assert.equal(lesson().question, null);
	});
	it("an open question gives its text and option labels, and never the answer", () => {
		assert.deepEqual(lesson({ pending: quiz("q1", "What do you undo first?") }).question, { text: "What do you undo first?", options: ["Add", "Subtract"] });
	});
	it("a question behind Check your understanding is not on screen, so it is left out", () => {
		assert.equal(lesson({ pending: quiz("q1", "What first?"), requiresReveal: true }).question, null);
	});
	it("a question the learner wrote in words has no options", () => {
		assert.deepEqual(lesson({ pending: { toolCallId: "e1", input: { question: "Why?", correctAnswer: "Because." } } }).question, { text: "Why?", options: [] });
	});
	it("a broken question is left out", () => {
		assert.equal(lesson({ pending: { toolCallId: "q1", input: null } }).question, null);
		assert.equal(lesson({ pending: { toolCallId: "q1", input: { options: [] } } }).question, null);
	});
	it("the answer shows once the learner has seen it for that open question", () => {
		const seen = { toolCallId: "q1", answer: "Subtract" };
		assert.deepEqual(lesson({ pending: quiz("q1", "What first?"), answerSeen: seen }).question, { text: "What first?", options: ["Add", "Subtract"], answer: "Subtract" });
	});
	it("a new question after a revealed one has no answer again", () => {
		const seen = { toolCallId: "q1", answer: "Subtract" };
		assert.equal(lesson({ pending: quiz("q2", "And then?"), answerSeen: seen }).question?.answer, undefined);
		assert.ok(!("answer" in lesson({ pending: quiz("q2", "And then?"), answerSeen: seen }).question!));
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
