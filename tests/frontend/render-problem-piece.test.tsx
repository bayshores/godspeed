import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import "../page-piece-dom.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRoot } from "react-dom/client";
import { OpenProblemPane } from "../../src/frontend/components/lesson/open-problem-pane.tsx";
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
	it("shows the piece in place of the typed statement, with the choices and key kept", async () => {
		await mounted(<OpenProblemPane statement={PIECE_TEXT} piece={piece} part={null} picks={null} />, (host) => {
			assert.equal(host.querySelectorAll("img").length, 2);
			assert.equal(host.querySelector('[data-testid="problem-statement"]'), null);
			assert.match(host.querySelector('[data-testid="problem-piece"] > div')!.className, /max-h-\[60vh\] overflow-y-auto/);
			const key = host.querySelector('[data-testid="piece-printed"]')!;
			assert.equal(key.textContent, "As printed");
			assert.match(key.className, /ml-auto/);
			assert.doesNotMatch(key.className, /w-full/);
		});
	});

	it("As printed turns the pictures to the white page and back", async () => {
		await mounted(<OpenProblemPane statement={PIECE_TEXT} piece={piece} part={null} picks={null} />, async (host) => {
			const key = host.querySelector<HTMLElement>('[data-testid="piece-printed"]')!;
			const srcs = () => [...host.querySelectorAll("img")].map((i) => i.getAttribute("src")!);
			assert.equal(key.getAttribute("aria-pressed"), "false");
			assert.ok(srcs().every((s) => s.includes("&ink=")));
			await act(async () => key.click());
			assert.equal(key.getAttribute("aria-pressed"), "true");
			assert.ok(srcs().every((s) => !s.includes("ink=")));
			assert.match(host.querySelector("img")!.parentElement!.className, /bg-white/);
			await act(async () => key.click());
			assert.ok(srcs().every((s) => s.includes("&ink=")));
		});
	});

	it("veils the parts that are not the one the learner is on", async () => {
		await mounted(<OpenProblemPane statement={PIECE_TEXT} piece={piece} part="b" picks={null} />, (host) => assert.equal(veils(host), 3));
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
