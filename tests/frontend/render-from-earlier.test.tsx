/** The From earlier card: one card per sitting, a one-line Right row whose
 *  topic words open its Why, a missed row with its question, the right
 *  answer and a Why button. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { FromEarlierCard } from "../../src/frontend/components/lesson/from-earlier-card.tsx";
import { fromEarlierRow } from "../../src/frontend/components/lesson/from-earlier-card-model.ts";
import { reviewDetails } from "../stop-fixtures.ts";

describe("fromEarlierRow", () => {
	it("a right row is one line with how sure he was", () => {
		assert.deepEqual(fromEarlierRow(reviewDetails("Eigenvalues", "right", 0)), {
			tone: "right",
			word: "Right",
			topic: "Eigenvalues",
			sure: 4,
			missed: false,
			question: "A question on Eigenvalues?",
			answerLine: "The answer was B, About 25%.",
		});
	});

	it("a miss and I don't know show the question and the right answer", () => {
		const wrong = fromEarlierRow(reviewDetails("Bayes' rule", "wrong", 0, 60));
		assert.equal(wrong.word, "Wrong");
		assert.equal(wrong.sure, 3);
		assert.equal(wrong.missed, true);
		const dontKnow = fromEarlierRow(reviewDetails("Bayes' rule", "dontKnow", 0));
		assert.deepEqual([dontKnow.tone, dontKnow.word, dontKnow.sure, dontKnow.missed], ["plain", "Didn't know", null, true]);
	});

	it("names the topic by its id when the name is missing, and leaves out an answer it cannot find", () => {
		const details = reviewDetails("Bayes' rule", "wrong", 0);
		const row = fromEarlierRow({ ...details, topic: "", answer: { ...details.answer, correctIndices: [] } });
		assert.equal(row.topic, "bayes' rule");
		assert.equal(row.answerLine, null);
	});
});

describe("FromEarlierCard", () => {
	const data = { sitting: "s", rows: [reviewDetails("Bayes' rule", "wrong", 0, 60), reviewDetails("Eigenvalues", "right", 0)] };

	it("draws the meta row, then a missed row with its question and answer, then a one-line right row", () => {
		const html = renderToStaticMarkup(<FromEarlierCard data={data} />);
		assert.match(html, /data-testid="from-earlier-card"[\s\S]*>From earlier</);
		const [wrong, right] = html.split('data-testid="from-earlier-row"').slice(1);
		assert.match(wrong!, />Wrong<[\s\S]*Bayes&#x27; rule, sure 3 of 5[\s\S]*data-testid="from-earlier-why"[\s\S]*A question on Bayes&#x27; rule\?[\s\S]*The answer was B, About 25%\./);
		assert.match(right!, />Right<[\s\S]*data-testid="from-earlier-topic"[^>]*>Eigenvalues<\/button>, sure 4 of 5/);
		assert.doesNotMatch(right!, /from-earlier-why|from-earlier-answer|A question on/);
	});

	it("the topic words open the Why of a right row", async () => {
		const { document, window } = parseHTML("<!doctype html><html><body></body></html>");
		Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true });
		const host = document.createElement("div");
		document.body.appendChild(host);
		const root = createRoot(host as unknown as HTMLElement);
		await act(async () => root.render(<FromEarlierCard data={data} />));
		assert.equal(host.querySelectorAll("[data-testid='from-earlier-details']").length, 0);
		await act(async () => (host.querySelector("[data-testid='from-earlier-topic']") as unknown as HTMLElement).click());
		const details = host.querySelectorAll("[data-testid='from-earlier-details']");
		assert.equal(details.length, 1);
		assert.match(details[0]!.textContent ?? "", /About 25%[\s\S]*Bayes\./);
		await act(async () => root.unmount());
	});
});
