/**
 * Follow's slip: its one line, the count, its list of the round's earlier rows (a change goes to
 * its page, a file read opens the source pop-up, other rows are words), and the "Go to" key
 * while Follow waits. Mounted over linkedom.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { AgentAction } from "../../src/shared/core/events.ts";
import type { TeacherApi } from "../../src/frontend/components/teacher/teacher-context.ts";
import type { FollowSlip as Slip } from "../../src/frontend/components/teacher/use-follow-slip.ts";
import type { SlipView } from "../../src/frontend/components/teacher/follow-slip-model.ts";

const dom = parseHTML("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	MutationObserver: dom.window.MutationObserver,
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		disconnect() {}
	},
});

const { createRoot } = await import("react-dom/client");
const { TeacherContext } = await import("../../src/frontend/components/teacher/teacher-context.ts");
const { FollowSlip } = await import("../../src/frontend/components/teacher/follow-slip.tsx");

const realFetch = globalThis.fetch;
let root: Root | undefined;
afterEach(async () => {
	await act(async () => root?.unmount());
	document.body.innerHTML = "";
	globalThis.fetch = realFetch;
});

const hw7: AgentAction = { id: "a1", at: "2026-11-22T20:00:02Z", agent: "Claude Code", label: "Adding HW7", spaceId: "spc", target: { kind: "deadline", id: "d7" }, page: "/space/deadlines" };
const VIEW: SlipView = {
	line: "Thinking",
	mark: "live",
	count: "3 steps",
	waiting: null,
	paused: false,
	past: [
		{ kind: "step", id: "s1", at: "2026-11-22T20:00:00Z", text: "Looking at CSE 21", link: null },
		{ kind: "step", id: "s2", at: "2026-11-22T20:00:01Z", text: "Reading HW7_F26.pdf, page 1", link: { spaceId: "spc", fileId: "f_0123456789ab", name: "HW7_F26.pdf", range: "p. 1" } },
		{ kind: "change", id: "a1", at: hw7.at, text: "Adding HW7", action: hw7 },
	],
	changesAt: null,
};

/** The slip as the provider hands it, its list open or shut as the learner set it. */
function Harness({ view, gone }: { view: SlipView | null; gone: AgentAction[] }) {
	const [open, setOpen] = React.useState(false);
	const slip: Slip | null = view && { view, still: true, open, setOpen };
	const api = { slip, go: (a: AgentAction) => gone.push(a) } as unknown as TeacherApi;
	return (
		<TeacherContext.Provider value={api}>
			<FollowSlip />
		</TeacherContext.Provider>
	);
}

async function mount(view: SlipView | null, gone: AgentAction[] = []) {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => root!.render(<Harness view={view} gone={gone} />));
}
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const click = (el: HTMLElement | null) => act(async () => el!.click());

describe("Follow's slip", () => {
	it("is not there without a slip", async () => {
		await mount(null);
		assert.ok(q("follow-slip") === null);
	});

	it("says the line, the count and opens its list as one button", async () => {
		await mount(VIEW);
		const line = q("follow-slip-line")!;
		assert.equal(line.textContent, "Thinking3 steps");
		assert.equal(line.getAttribute("aria-expanded"), "false");
		assert.ok(q("follow-slip-list") === null, "shut, no list is drawn");
		assert.equal(q("follow-slip")!.getAttribute("aria-live"), null, "the strip's announcer says it, not the slip");
		await click(line);
		assert.equal(line.getAttribute("aria-expanded"), "true");
		const rows = [...document.querySelectorAll('[data-testid="follow-slip-row"]')];
		assert.deepEqual(rows.map((r) => [r.tagName, r.textContent]), [
			["DIV", "Looking at CSE 21"],
			["BUTTON", "Reading HW7_F26.pdf, page 1"],
			["BUTTON", "Adding HW7"],
		]);
	});

	it("a change row goes to it, a file read opens the source pop-up", async () => {
		globalThis.fetch = (async () => Response.json({ range: "p. 1", page: null, text: "Problem 1", marks: null })) as typeof fetch;
		const gone: AgentAction[] = [];
		await mount(VIEW, gone);
		await click(q("follow-slip-line"));
		const row = (i: number) => [...document.querySelectorAll<HTMLElement>('[data-testid="follow-slip-row"]')][i]!;
		await click(row(2));
		assert.ok(gone[0] === hw7);
		assert.equal(q("follow-slip-line")!.getAttribute("aria-expanded"), "false", "the list shuts");
		await click(q("follow-slip-line"));
		await click(row(1));
		assert.ok(q("cite-dialog") !== null);
	});

	it("with nothing earlier to list it is words, not a button that opens nothing", async () => {
		await mount({ ...VIEW, line: "Looking at CSE 21", past: [], count: "1 step" });
		const line = q("follow-slip-line")!;
		assert.equal(line.getAttribute("aria-expanded"), null);
		assert.ok(line.hasAttribute("disabled"));
	});

	it("while Follow waits, its Go to key goes to the change it waits to show", async () => {
		const gone: AgentAction[] = [];
		await mount({ ...VIEW, line: "Paused while you type", mark: "still", paused: true, waiting: hw7 }, gone);
		const key = q("follow-slip-go")!;
		assert.equal(key.textContent, "Go to Deadlines");
		await click(key);
		assert.ok(gone[0] === hw7);
	});
});
