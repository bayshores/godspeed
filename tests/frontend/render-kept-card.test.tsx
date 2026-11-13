/** The kept card: his sentence, the phrase, the analogy lines, the source,
 *  the drop and bring back words and Why; the model behind it. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { KeptCard } from "../../src/frontend/components/lesson/kept-card.tsx";
import { keptCardView, keptSource } from "../../src/frontend/components/lesson/kept-card-model.ts";
import { ChatActionsContext } from "../../src/frontend/components/chat-actions-context.ts";
import type { KeptCardData, KeptPart } from "../../src/shared/core/index.ts";
import { KEEP, keepAnswer, SOURCE_MARK } from "../kept-fixtures.ts";

const FULL: KeptCardData = { text: KEEP.text, fits: KEEP.fits, stops: KEEP.stops, analogyDropped: false, phrase: KEEP.phrase, phraseDropped: false, source: SOURCE_MARK };

function render(kept: KeptCardData, dropKept: (of: string, part: KeptPart, back: boolean) => void = () => {}): string {
	return renderToStaticMarkup(
		<ChatActionsContext.Provider value={{ chatId: "c1", sendBlocked: null, sendText: () => {}, dropKept }}>
			<KeptCard kept={kept} answer={keepAnswer("right")} input={{ type: "check", nodeId: "reg" }} toolCallId="call_k" />
		</ChatActionsContext.Provider>,
	);
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("keptCardView", () => {
	it("names the source by its file and page, and says the phrase", () => {
		const view = keptCardView(FULL);
		assert.equal(view.source?.name, "Lecture 6.pdf");
		assert.equal(view.source?.range, "p. 14");
		assert.deepEqual(view.phrase, { line: "Remember it as Price, not cap", shown: true });
		assert.deepEqual(view.analogy, { fits: KEEP.fits, stops: KEEP.stops, shown: true });
	});

	it("a dropped part stays known but not shown; a missing one is null", () => {
		const view = keptCardView({ ...FULL, analogyDropped: true, phraseDropped: true });
		assert.equal(view.analogy?.shown, false);
		assert.equal(view.phrase?.shown, false);
		const plain = keptCardView({ text: KEEP.text });
		assert.deepEqual([plain.analogy, plain.phrase, plain.source], [null, null, null]);
	});

	it("a source that is not a space file place links nowhere", () => {
		assert.equal(keptSource("[[https://example.com/notes]]"), null);
		assert.equal(keptSource("not a mark"), null);
		assert.equal(keptSource(undefined), null);
	});
});

describe("KeptCard", () => {
	it("full: the sentence, the phrase, fits and stops, then the source, Drop this analogy and Why", () => {
		const html = render(FULL);
		assert.match(html, /data-testid="kept-card"/);
		const words = text(html);
		assert.match(words, /prices large weights; it does not cap them\.[\s\S]*Remember it as Price, not cap[\s\S]*Drop this[\s\S]*The leash fits one part[\s\S]*It stops at new data[\s\S]*Lecture 6\.pdf, p\. 14[\s\S]*Drop this analogy[\s\S]*Why/);
		assert.match(html, /class="katex"/, "the sentence's math is typeset");
		assert.doesNotMatch(html, /Bring the/);
		assert.doesNotMatch(html, /kept-why-details/, "Why starts closed");
	});

	it("analogy dropped: the sentence, then the bottom row with Bring the analogy back", () => {
		const html = render({ ...FULL, analogyDropped: true });
		assert.doesNotMatch(html, /The leash fits one part|It stops at new data/);
		assert.match(text(html), /Lecture 6\.pdf, p\. 14[\s\S]*Bring the analogy back[\s\S]*Why/);
	});

	it("phrase dropped: no phrase, and Bring the phrase back in the bottom row", () => {
		const html = render({ ...FULL, phraseDropped: true });
		assert.doesNotMatch(html, /Remember it as/);
		assert.match(text(html), /Bring the phrase back[\s\S]*Drop this analogy/);
	});

	it("no analogy: no analogy words at all", () => {
		const html = render({ text: KEEP.text, source: SOURCE_MARK });
		assert.doesNotMatch(html, /analogy/);
		assert.match(text(html), /Lecture 6\.pdf, p\. 14[\s\S]*Why/);
	});

	it("no source: the sentence and Why keep their places", () => {
		const html = render({ text: KEEP.text });
		assert.doesNotMatch(html, /kept-source/);
		assert.match(html, /data-testid="kept-why"/);
	});

	it("is a group named for a right answer, so a screen reader hears Right before Why opens", () => {
		assert.match(render(FULL), /^<div data-testid="kept-card" data-kept="" role="group" aria-label="Right, kept sentence"/);
	});

	it("outside a lesson it offers no drop", () => {
		const html = renderToStaticMarkup(<KeptCard kept={FULL} answer={keepAnswer("right")} input={{}} toolCallId="call_k" />);
		assert.doesNotMatch(html, /Drop this|Bring the/);
	});

	it("the words post the drop and the bring back, and Why opens the quiz that earned it", async () => {
		const { document, window } = parseHTML("<!doctype html><html><body></body></html>");
		Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true });
		const host = document.createElement("div");
		document.body.appendChild(host);
		const root = createRoot(host as unknown as HTMLElement);
		const posted: Array<[string, KeptPart, boolean]> = [];
		const dropKept = (of: string, part: KeptPart, back: boolean) => void posted.push([of, part, back]);
		const mount = (kept: KeptCardData) =>
			root.render(
				<ChatActionsContext.Provider value={{ chatId: "c1", sendBlocked: null, sendText: () => {}, dropKept }}>
					<KeptCard kept={kept} answer={keepAnswer("right")} input={{ type: "check", nodeId: "reg" }} toolCallId="call_k" />
				</ChatActionsContext.Provider>,
			);
		const click = (id: string) => (host.querySelector(`[data-testid='${id}']`) as unknown as HTMLElement).click();
		await act(async () => mount(FULL));
		await act(async () => click("kept-analogy-toggle"));
		await act(async () => click("kept-drop-phrase"));
		await act(async () => mount({ ...FULL, analogyDropped: true, phraseDropped: true }));
		await act(async () => click("kept-analogy-toggle"));
		await act(async () => click("kept-bring-phrase"));
		assert.deepEqual(posted, [
			["call_k", "analogy", false],
			["call_k", "phrase", false],
			["call_k", "analogy", true],
			["call_k", "phrase", true],
		]);
		await act(async () => click("kept-why"));
		const why = host.querySelector("[data-testid='kept-why-details']")?.textContent ?? "";
		assert.match(why, /Right[\s\S]*Quiz, sure 4 of 5[\s\S]*Where is that weight now\?[\s\S]*6[\s\S]*moves to 6/);
		await act(async () => root.unmount());
	});

	it("after the phrase is dropped or brought back, focus moves to the other control", async () => {
		const { document, window } = parseHTML("<!doctype html><html><body></body></html>");
		Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true });
		// linkedom tracks no focus, so focus() here records which button took it.
		const focused: string[] = [];
		(window.HTMLElement.prototype as unknown as { focus: () => void }).focus = function (this: HTMLElement) {
			focused.push(this.getAttribute("data-testid") ?? "");
		};
		const host = document.createElement("div");
		document.body.appendChild(host);
		const root = createRoot(host as unknown as HTMLElement);
		let kept = FULL;
		const mount = () =>
			root.render(
				<ChatActionsContext.Provider value={{ chatId: "c1", sendBlocked: null, sendText: () => {}, dropKept: (_of, _part, back) => void (kept = { ...kept, phraseDropped: !back }) }}>
					<KeptCard kept={kept} answer={keepAnswer("right")} input={{ type: "check", nodeId: "reg" }} toolCallId="call_k" />
				</ChatActionsContext.Provider>,
			);
		const click = (id: string) => (host.querySelector(`[data-testid='${id}']`) as unknown as HTMLElement).click();
		await act(async () => mount());
		await act(async () => click("kept-drop-phrase"));
		await act(async () => mount());
		assert.deepEqual(focused, ["kept-bring-phrase"]);
		await act(async () => click("kept-bring-phrase"));
		await act(async () => mount());
		await act(async () => mount());
		assert.deepEqual(focused, ["kept-bring-phrase", "kept-drop-phrase"]);
		await act(async () => root.unmount());
	});
});
