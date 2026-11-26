import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import "../page-piece-dom.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRoot } from "react-dom/client";
import { OpenProblemPane, type ProblemPicks } from "../../src/frontend/components/lesson/open-problem-pane.tsx";
import { TurnPlaceContext, type TurnPlace } from "../../src/frontend/components/lesson/turn-place.ts";
import { ProblemCard } from "../../src/frontend/components/practice-cards.tsx";
import { problemPieceOf, projectView, type ArtifactPartProps, type LhMessage } from "../../src/shared/core/index.ts";
import { PIECE_DETAILS, PIECE_TEXT } from "../piece-fixtures.ts";

async function mounted(node: React.ReactNode, run: (host: HTMLElement) => Promise<void> | void) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	try {
		await act(async () => root.render(node));
		await run(host);
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
}

const piece = problemPieceOf(PIECE_DETAILS)!;
const veils = (host: HTMLElement) => host.querySelectorAll('[data-testid="piece-veil"]').length;

describe("the open problem, printed in its file", () => {
	it("shows the piece in place of the typed statement, in the box Your turn scrolls and not one of its own", async () => {
		await mounted(<OpenProblemPane statement={PIECE_TEXT} piece={piece} part={null} picks={null} />, (host) => {
			assert.equal(host.querySelectorAll("img").length, 2);
			assert.equal(host.querySelector('[data-testid="problem-statement"]'), null);
			assert.doesNotMatch(host.innerHTML, /max-h-|overflow-y/);
			assert.ok([...host.querySelectorAll("img")].every((i) => i.getAttribute("src")!.includes("&ink=")));
		});
	});

	it("draws the pictures on the white page, with no ink, when asked as printed", async () => {
		await mounted(<OpenProblemPane statement={PIECE_TEXT} piece={piece} printed part="b" picks={null} />, (host) => {
			assert.ok([...host.querySelectorAll("img")].every((i) => !i.getAttribute("src")!.includes("ink=")));
			assert.match(host.querySelector('[data-testid="page-piece"]')!.className, /lh-printed/);
			// A veil in the sheet's color would be a dark block on the white page.
			assert.ok([...host.querySelectorAll('[data-testid="piece-veil"]')].every((veil) => /bg-white/.test(veil.className)));
		});
	});

	it("veils the parts that are not the one the learner is on", async () => {
		await mounted(<OpenProblemPane statement={PIECE_TEXT} piece={piece} part="b" picks={null} />, (host) => assert.equal(veils(host), 4, "and the lines around the problem"));
	});

	it("beside the text its sheet is the whole page, top to foot; elsewhere, and with choices under it, the problem with a line around it", async () => {
		const crops = async (place: TurnPlace, picks: ProblemPicks | null) => {
			let found: (string | undefined)[] = [];
			await mounted(
				<TurnPlaceContext.Provider value={place}>
					<OpenProblemPane statement={PIECE_TEXT} piece={piece} part={null} picks={picks} />
				</TurnPlaceContext.Provider>,
				(host) => void (found = [...host.querySelectorAll('[data-testid="page-piece"] img')].map((img) => /crop=([\d.,]+)/.exec(img.getAttribute("src") ?? "")?.[1])),
			);
			return found;
		};
		const short = ["0.1,0.57,0.9,0.95", "0.1,0.05,0.9,0.53"];
		assert.deepEqual(await crops("left", null), ["0.1,0,0.9,0.95", "0.1,0.05,0.9,1"]);
		assert.deepEqual(await crops("pinned", null), short);
		assert.deepEqual(await crops("left", { choices: { labels: ["Yes", "No"], multiSelect: false }, picked: { selected: new Set<number>() }, onPick: () => {}, onLeaveRows: () => {}, onEnter: null }), short);
	});

	it("opens resting on the part the learner is on, and glides to the part he moves on to", async () => {
		const scrolls: ScrollToOptions[] = [];
		const host = document.createElement("div");
		host.className = "lh-turn-scroll";
		// The box is shorter than the problem's page.
		Object.defineProperty(host, "scrollHeight", { get: () => 400 });
		Object.defineProperty(host, "clientHeight", { get: () => 100 });
		Object.assign(host, { scrollTo: (to: ScrollToOptions) => scrolls.push(to) });
		document.body.append(host);
		const root = createRoot(host);
		const pane = (part: string) => <OpenProblemPane statement={PIECE_TEXT} piece={piece} part={part} picks={null} />;
		try {
			await act(async () => root.render(pane("a")));
			assert.deepEqual(scrolls.map((to) => to.behavior), ["auto"]);
			await act(async () => root.render(pane("b")));
			assert.deepEqual(scrolls.map((to) => to.behavior), ["auto", "smooth"]);
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});

	it("keeps the typed statement, and no key, for a problem with no piece", async () => {
		await mounted(<OpenProblemPane statement="Show that the sum is even." part={null} picks={null} />, (host) => {
			assert.match(host.querySelector('[data-testid="problem-statement"]')!.textContent ?? "", /Show that the sum is even\./);
			assert.equal(host.querySelector('[data-testid="piece-printed"]'), null);
			assert.equal(host.querySelectorAll("img").length, 0);
		});
	});
});

describe("the problem's card in the lesson text", () => {
	const part = (over: Partial<ArtifactPartProps["part"]>): ArtifactPartProps["part"] => ({ type: "tool-problem", state: "output-available", toolCallId: "call_p1", ...over });

	it("draws the piece quietly, with no key and no cap", async () => {
		await mounted(<ProblemCard part={part({ input: { mode: "recall" }, output: PIECE_DETAILS })} />, (host) => {
			assert.equal(host.querySelectorAll("img").length, 2);
			assert.match(host.querySelector('[data-testid="page-piece"]')!.className, /opacity-60/);
			assert.equal(host.querySelector('[data-testid="piece-printed"]'), null);
			assert.doesNotMatch(host.innerHTML, /max-h-/);
		});
	});

	it("keeps drawing the piece from a record the view built, once the problem is concluded", async () => {
		const record = [
			{ id: "a1", role: "assistant", content: [{ type: "toolCall", id: "call_p1", name: "problem", arguments: { mode: "recall", modelSolution: "x" } }], timestamp: 1 },
			{ id: "r1", role: "toolResult", toolCallId: "call_p1", toolName: "problem", content: [{ type: "text", text: "Problem posed." }], details: PIECE_DETAILS, isError: false, timestamp: 2 },
			{ id: "a2", role: "assistant", content: [{ type: "toolCall", id: "call_c1", name: "conclude", arguments: { outcome: "solved" } }], timestamp: 3 },
			{ id: "r2", role: "toolResult", toolCallId: "call_c1", toolName: "conclude", content: [{ type: "text", text: "Concluded." }], details: null, isError: false, timestamp: 4 },
		] as unknown as LhMessage[];
		const viewed = projectView(record).flatMap((m) => m.parts).find((p) => p.type === "tool-problem")!;
		await mounted(<ProblemCard part={viewed as ArtifactPartProps["part"]} />, (host) => assert.equal(host.querySelectorAll("img").length, 2));
	});

	it("keeps the typed statement for a problem with no piece", async () => {
		await mounted(<ProblemCard part={part({ state: "input-available", input: { statement: "Prove the parity claim." } })} />, (host) => {
			assert.match(host.textContent ?? "", /Prove the parity claim\./);
			assert.equal(host.querySelectorAll("img").length, 0);
		});
	});
});
