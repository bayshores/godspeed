/**
 * Questions from earlier in the window: answers in a row in one sitting
 * share one card; the open question is a pending quiz the app posed, ahead
 * of the teacher's own question; a review marker written mid-turn is never
 * taken for the learner's input.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { danglingQuestionOf, needsContinuation, type LhMessage } from "../../src/shared/core/native-messages.ts";
import { findPendingToolCall } from "../../src/shared/core/pending.ts";
import { projectView, withOpenReview, type FromEarlierData } from "../../src/shared/core/view.ts";
import type { ReviewQuestion } from "../../src/shared/core/contracts/chat.ts";
import { call, marker, result, review, reviewDetails, text, userText } from "../stop-fixtures.ts";

const cards = (messages: LhMessage[]) =>
	projectView(messages)
		.flatMap((m) => m.parts)
		.filter((p) => p.type === "data-from-earlier")
		.map((p) => (p.data as FromEarlierData).rows.map((r) => r.topic));

const QUESTION: ReviewQuestion = {
	of: { chatId: "chat_old", messageId: "m_q", toolCallId: "rv_bayes" },
	nodeId: "bayes",
	topic: "Bayes' rule",
	quiz: { question: "How likely?", options: [{ label: "About 60%" }, { label: "About 25%" }], correctAnswer: "About 25%", explanation: "Bayes." },
};

describe("projectView: From earlier", () => {
	it("answers in a row in one sitting are one card, a row each in order", () => {
		const messages = [
			userText("u1", "Start", 0),
			review("r1", reviewDetails("Bayes' rule", "wrong", 0), 1),
			marker("n1", "app-note", { kinds: ["from-earlier"] }, 1.5, "[From earlier] ..."),
			review("r2", reviewDetails("Eigenvalues", "right", 0), 2),
			text("t1", "Here is the page.", 3),
		];
		assert.deepEqual(cards(messages), [["Bayes' rule", "Eigenvalues"]]);
		const view = projectView(messages);
		assert.equal(view[1]!.role, "user");
		assert.equal(view[1]!.id, "r1");
	});

	it("a new sitting, or teacher words between, starts a new card", () => {
		assert.deepEqual(cards([review("r1", reviewDetails("Bayes' rule", "right", 0), 1), review("r2", reviewDetails("Eigenvalues", "right", 60), 61)]), [["Bayes' rule"], ["Eigenvalues"]]);
		assert.deepEqual(cards([review("r1", reviewDetails("Bayes' rule", "right", 0), 1), text("t1", "Next.", 2), review("r2", reviewDetails("Eigenvalues", "right", 0), 3)]), [["Bayes' rule"], ["Eigenvalues"]]);
	});

	it("a marker with no answer draws nothing", () => {
		assert.deepEqual(cards([marker("r1", "review", { of: QUESTION.of }, 1)]), []);
	});
});

describe("withOpenReview", () => {
	it("is the pending question, posed by the app, keyed by its source quiz", () => {
		assert.deepEqual(findPendingToolCall(withOpenReview(projectView([userText("u1", "Start", 0)]), QUESTION)), {
			toolCallId: "rv_bayes",
			tool: "quiz",
			input: QUESTION.quiz,
			appPosed: { kind: "review", ref: { chatId: "chat_old", toolCallId: "rv_bayes" } },
		});
	});

	it("comes before the teacher's question, which follows once it is answered or skipped", () => {
		const view = projectView([userText("u1", "Start", 0), call("q1", "quiz", { question: "Teacher's?", options: [{ label: "a" }, { label: "b" }], correctAnswer: "a", explanation: "e" }, 1)]);
		assert.equal(findPendingToolCall(withOpenReview(view, QUESTION))?.appPosed?.kind, "review");
		assert.equal(findPendingToolCall(withOpenReview(view, null))?.toolCallId, "q1");
	});
});

describe("a review marker written mid-turn", () => {
	it("is not his input: the turn's question still waits and a fulfilled tool still owes a continuation", () => {
		const asked = [userText("u1", "Start", 0), call("q1", "quiz", { question: "q", options: [{ label: "a" }, { label: "b" }], correctAnswer: "a", explanation: "e" }, 1)];
		assert.equal(danglingQuestionOf([...asked, review("r1", reviewDetails("Bayes' rule", "right", 0), 2)])?.toolCallId, "q1");

		const read = [userText("u1", "Start", 0), call("rd", "read", { path: "a.pdf" }, 1), result("rd", "read", null, 1)];
		assert.equal(needsContinuation(read), true);
		assert.equal(needsContinuation([...read, review("r1", reviewDetails("Bayes' rule", "right", 0), 2)]), true);
	});
});
