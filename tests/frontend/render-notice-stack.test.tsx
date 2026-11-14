/**
 * The corner notice stack: at most 3 notices show, update and restart
 * first, one quiet-space notice at a time; the rest wait, hidden, until
 * one closes, and a waiting notice's time starts once it shows. Mounted
 * over linkedom.
 */
import React, { act, useEffect, useState } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";

const dom = parseHTML("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	MutationObserver: dom.window.MutationObserver,
	IS_REACT_ACT_ENVIRONMENT: true,
});

const { createRoot } = await import("react-dom/client");
const { createPortal } = await import("react-dom");
const { NoticeStack, NOTICE_STACK_ID } = await import("../../src/frontend/components/notice-stack.tsx");
const { shownNotices } = await import("../../src/frontend/components/notice-stack-model.ts");
const { QuietNoticeView } = await import("../../src/frontend/components/quiet-notice.tsx");
const { DoneNotice } = await import("../../src/frontend/components/done-notice.tsx");

describe("shownNotices", () => {
	it("shows 3 in order, the rest wait", () => {
		assert.deepEqual(shownNotices([null, null, null, null]), [true, true, true, false]);
	});

	it("update and restart come first, even when they came last", () => {
		assert.deepEqual(shownNotices([null, null, null, "first"]), [true, true, false, true]);
	});

	it("one quiet-space notice at a time, and the waiting ones take no place", () => {
		assert.deepEqual(shownNotices(["quiet", "quiet", "quiet", null]), [true, false, false, true]);
	});
});

let root: Root | undefined;
afterEach(async () => {
	await act(async () => root?.unmount());
	document.body.innerHTML = "";
});

const mount = async (node: React.ReactNode) => {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => root!.render(node));
};
const cards = (selector: string) => [...document.querySelectorAll(`#${NOTICE_STACK_ID} > ${selector}`)];
/** The stack, once it is in the page, for the notices that portal into it. */
function useStack() {
	const [stack, setStack] = useState<HTMLElement | null>(null);
	useEffect(() => setStack(document.getElementById(NOTICE_STACK_ID)), []);
	return stack;
}
const shownIds = () => cards("*").filter((c) => !c.hasAttribute("hidden")).map((c) => c.getAttribute("data-testid"));

/** Two notices inside the stack and two portaled into it, as DoneNotice is; each closes. */
function Four() {
	const [open, setOpen] = useState(["a", "b", "c", "d"]);
	const card = (id: string) =>
		open.includes(id) && (
			<div key={id} data-testid={id} role="status" onClick={() => setOpen((list) => list.filter((x) => x !== id))}>
				{id}
			</div>
		);
	const stack = useStack();
	return (
		<>
			<NoticeStack>
				{card("a")}
				{card("b")}
			</NoticeStack>
			{stack && createPortal(<>{card("c")}{card("d")}</>, stack)}
		</>
	);
}

describe("The notice stack", () => {
	it("shows 3 of 4 notices; closing one shows the 4th", async () => {
		await mount(<Four />);
		assert.deepEqual(shownIds(), ["a", "b", "c"]);
		assert.ok(cards('[data-testid="d"]')[0]!.hasAttribute("hidden"), "the waiting one is hidden, so a screen reader skips it");
		await act(async () => (cards('[data-testid="b"]')[0] as HTMLElement).click());
		assert.deepEqual(shownIds(), ["a", "c", "d"]);
	});

	it("two quiet spaces: one notice shows, the other waits", async () => {
		const quiet = (spaceId: string) => ({ spaceId, name: spaceId.toUpperCase(), folder: `/drive/${spaceId}`, lastAt: new Date(2026, 10, 1).toISOString() });
		const now = new Date(2026, 10, 6).getTime();
		function TwoQuiet() {
			const stack = useStack();
			return (
				<>
					<NoticeStack>{null}</NoticeStack>
					{stack && createPortal(<QuietNoticeView quiet={[quiet("cse21"), quiet("cse29")]} now={now} onSee={() => {}} onDismiss={() => {}} />, stack)}
				</>
			);
		}
		await mount(<TwoQuiet />);
		const notices = cards('[data-testid="quiet-notice"]');
		assert.equal(notices.length, 2);
		assert.deepEqual(notices.map((n) => n.hasAttribute("hidden")), [false, true]);
	});

	it("a 4th notice that waits hidden starts its time only once it shows", async () => {
		mock.timers.enable({ apis: ["setTimeout"] });
		try {
			let expired = 0;
			const onExpire = () => expired++;
			function ThreeAndDone() {
				const [open, setOpen] = useState(["a", "b", "c"]);
				const stack = useStack();
				return (
					<>
						<NoticeStack>
							{open.map((id) => (
								<div key={id} data-testid={id} role="status" onClick={() => setOpen((list) => list.filter((x) => x !== id))}>
									{id}
								</div>
							))}
						</NoticeStack>
						{stack && <DoneNotice text="Ticking that deadline done didn't save." onExpire={onExpire} />}
					</>
				);
			}
			await mount(<ThreeAndDone />);
			const done = () => cards('[data-testid="done-notice"]')[0]!;
			assert.ok(done().hasAttribute("hidden"), "the 4th waits hidden");
			await act(async () => mock.timers.tick(30_000));
			assert.equal(expired, 0, "its time does not run while it waits");

			await act(async () => (cards('[data-testid="b"]')[0] as HTMLElement).click());
			assert.ok(!done().hasAttribute("hidden"), "it shows once one closes");
			await act(async () => mock.timers.tick(5_000));
			assert.equal(expired, 0, "it stays its full time from when it showed");
			await act(async () => mock.timers.tick(1_500));
			assert.equal(expired, 1);
		} finally {
			mock.timers.reset();
		}
	});
});
