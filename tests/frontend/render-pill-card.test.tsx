/**
 * The pill's open card (pill-card.tsx): a row per live thing with its
 * button, then Talk; a page with its own bar has neither Talk nor Activity.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { PillCard } from "../../src/frontend/components/top-bar/pill-card.tsx";
import { pillThings } from "../../src/frontend/components/top-bar/live-pill-model.ts";

const teaching = { connected: true, teaching: true, helperHere: true, helperCovering: false, pendingWork: 0, pendingTurns: 0, claimedLessons: [], name: "Claude Code" };
const things = pillThings({
	name: "Teacher",
	doing: { text: "Reading 06_Counting.pdf", count: "3 of 12", working: true },
	agent: teaching,
	terminal: null,
	work: { worker: "Helper", doing: "reading files", count: "6 of 17", tag: "6 of 17 files" },
	ready: [{ id: "l1", title: "Counting" }],
	due: { id: "hw5", spaceId: "c21", name: "Homework 5", date: "2026-11-15", time: "23:59" },
	offer: null,
});
const teacher = things.find((t) => t.kind === "teacher")!;

function render(over: Partial<Parameters<typeof PillCard>[0]> = {}) {
	const html = renderToStaticMarkup(<PillCard things={things} main={teacher} name="Teacher" panel follow onAct={() => {}} onTalk={() => {}} {...over} />);
	const { document } = parseHTML(`<html><body>${html}</body></html>`);
	const text = (el: Element) => el.textContent!.replace(/\s+/g, " ").trim();
	return {
		rows: [...document.querySelectorAll('[data-testid^="pill-row-"]')].map(text),
		buttons: [...document.querySelectorAll("button")].map(text),
	};
}

describe("The pill's card", () => {
	it("a row per live thing with its button; the pill's own thing leaves its name out", () => {
		const { rows, buttons } = render();
		assert.deepEqual(rows, ["CountingYour turnOpen", "Reading 06_Counting.pdfPart 3 of 12", "Reading filesHelper, 6 of 17Activity", "Homework 5Due in Open"]);
		assert.deepEqual(buttons, ["Open", "Activity", "Open", "Talk to Teacher"]);
	});

	it("the teacher's question brings Answer", () => {
		const needs = pillThings({ name: "Teacher", doing: null, agent: teaching, terminal: "needsYou", work: null, ready: [], due: null, offer: null });
		assert.deepEqual(render({ things: needs, main: needs[0] }).rows, ["Needs youAnswer"]);
	});

	it("a page with its own bar has no teacher panel: neither Talk nor Activity", () => {
		assert.deepEqual(render({ panel: false }).buttons, ["Open", "Open"]);
	});
});
