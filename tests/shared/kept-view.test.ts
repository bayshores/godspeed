/** When a quiz with a kept sentence becomes the kept card, and what the card
 *  shows after drops and bring-backs (the server report's rule, every row). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { projectView, type KeptCardData, type LhMessage, type LhViewPart } from "../../src/shared/core/index.ts";
import { userText } from "../stop-fixtures.ts";
import { drop, KEEP, keepAnswer, keptLesson, SHOWN, SOURCE_MARK } from "../kept-fixtures.ts";

function quizPart(messages: LhMessage[]): LhViewPart | undefined {
	return projectView([userText("u", "Go.", 0), ...messages])
		.flatMap((m) => m.parts)
		.find((p) => p.type === "tool-quiz");
}

const kept = (messages: LhMessage[]) => quizPart(messages)?.kept as KeptCardData | undefined;

describe("joinKept", () => {
	it("a right answer to a quiz with a shown keep is the kept card", () => {
		const part = quizPart(keptLesson());
		assert.equal(part?.state, "output-available", "it stays the answered quiz part");
		assert.deepEqual(part?.kept, {
			text: KEEP.text,
			fits: KEEP.fits,
			stops: KEEP.stops,
			analogyDropped: false,
			phrase: KEEP.phrase,
			phraseDropped: false,
			source: SOURCE_MARK,
		});
	});

	it("a wrong answer, I don't know and a skip keep the answered card", () => {
		for (const verdict of ["wrong", "dontKnow", "dismissed"] as const) {
			assert.equal(kept(keptLesson({ answer: keepAnswer(verdict) })), undefined, verdict);
		}
	});

	it("no answer yet shows no card", () => {
		assert.equal(kept(keptLesson({ answer: null })), undefined);
	});

	it("a dropped verdict or no keep-check marker (an old lesson) keeps the answered card", () => {
		assert.equal(kept(keptLesson({ verdict: { quizCallId: "call_k", keep: "dropped", fits: false, phrase: false, note: "keep not stored: text 212 characters, at most 160. Add it to a later quiz." } })), undefined);
		assert.equal(kept(keptLesson({ verdict: null })), undefined);
	});

	it("a verdict for another quiz does not count", () => {
		assert.equal(kept(keptLesson({ verdict: { ...SHOWN, quizCallId: "call_other" } })), undefined);
	});

	it("reads a keep sent as a JSON string, and ignores one that does not parse", () => {
		assert.equal(kept(keptLesson({ keep: JSON.stringify(KEEP) }))?.text, KEEP.text);
		assert.equal(kept(keptLesson({ keep: "{not json" })), undefined);
	});

	it("shows only the parts the verdict passed", () => {
		const card = kept(keptLesson({ verdict: { quizCallId: "call_k", keep: "shown", fits: false, phrase: false, source: "dropped" } }));
		assert.deepEqual(card, { text: KEEP.text });
	});

	it("a keep with stops but no fits has no analogy lines", () => {
		const card = kept(keptLesson({ keep: { text: KEEP.text, stops: KEEP.stops } }));
		assert.deepEqual(card, { text: KEEP.text, source: SOURCE_MARK });
	});

	it("drops and bring-backs: the last marker of each kind wins", () => {
		const base = keptLesson();
		assert.equal(kept([...base, drop("analogy-drop", false, 10)])?.analogyDropped, true);
		assert.equal(kept([...base, drop("analogy-drop", false, 10), drop("analogy-drop", true, 11)])?.analogyDropped, false);
		assert.equal(kept([...base, drop("analogy-drop", false, 10), drop("analogy-drop", true, 11), drop("analogy-drop", false, 12)])?.analogyDropped, true);
		const phrase = kept([...base, drop("phrase-drop", false, 10)]);
		assert.equal(phrase?.phraseDropped, true);
		assert.equal(phrase?.analogyDropped, false, "a phrase drop leaves the analogy");
		assert.equal(kept([...base, drop("phrase-drop", false, 10), drop("phrase-drop", true, 11)])?.phraseDropped, false);
	});

	it("the markers draw nothing of their own", () => {
		const view = projectView([userText("u", "Go.", 0), ...keptLesson(), drop("analogy-drop", false, 10)]);
		assert.ok(!view.flatMap((m) => m.parts).some((p) => p.type.startsWith("data-")));
	});
});
