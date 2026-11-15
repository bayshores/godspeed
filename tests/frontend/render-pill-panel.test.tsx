/**
 * The pill's panel and its notices: at most 3 notices show, update and
 * restart first, one quiet-space notice at a time; the rest wait, hidden,
 * until one closes, and a waiting notice's time starts once it shows. A
 * notice folds into the pill after a while and comes back when the pill's
 * card opens; the pill says the title of the one that just came. Mounted
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
const { MemoryRouter } = await import("react-router");
const { PillPanel, NOTICE_STACK_ID } = await import("../../src/frontend/components/top-bar/pill-panel.tsx");
const { NoticeCard } = await import("../../src/frontend/components/notice-card.tsx");
const { setNoticesOpen, useNotices, usePillMounted } = await import("../../src/frontend/components/notice-store.ts");
const { QuietNoticeView } = await import("../../src/frontend/components/quiet-notice.tsx");
const { DoneNotice } = await import("../../src/frontend/components/done-notice.tsx");

let root: Root | undefined;
afterEach(async () => {
	await act(async () => root?.unmount());
	await act(async () => setNoticesOpen(false));
	document.body.innerHTML = "";
});

const mount = async (node: React.ReactNode) => {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => root!.render(<MemoryRouter>{node}</MemoryRouter>));
};
const cards = (selector: string) => [...document.querySelectorAll(`#${NOTICE_STACK_ID} > ${selector}`)];
const card = (id: string) => cards(`[data-testid="${id}"]`)[0] as HTMLElement;
const panel = () => document.querySelector('[data-testid="pill-panel"]')!;
/** The stack, once it is in the page, for the notices that portal into it. */
function useStack() {
	const [stack, setStack] = useState<HTMLElement | null>(null);
	useEffect(() => setStack(document.getElementById(NOTICE_STACK_ID)), []);
	return stack;
}
const shownIds = () => cards("*").filter((c) => !c.hasAttribute("hidden")).map((c) => c.getAttribute("data-testid"));

/** A notice with a button that closes it. */
function Notices({ ids, timed }: { ids: string[]; timed?: boolean }) {
	const [open, setOpen] = useState(ids);
	return open.map((id) => (
		<NoticeCard
			key={id}
			data-testid={id}
			role="status"
			title={`Notice ${id}`}
			timed={timed}
			actions={
				<button type="button" data-testid={`close-${id}`} onClick={() => setOpen((list) => list.filter((x) => x !== id))}>
					OK
				</button>
			}
		/>
	));
}
const close = (id: string) => act(async () => (document.querySelector(`[data-testid="close-${id}"]`) as HTMLElement).click());

/** Two notices inside the panel and two portaled into it, as DoneNotice is. */
function Four() {
	const stack = useStack();
	return (
		<>
			<PillPanel>
				<Notices ids={["a", "b"]} />
			</PillPanel>
			{stack && createPortal(<Notices ids={["c", "d"]} />, stack)}
		</>
	);
}

describe("The notices under the pill", () => {
	it("shows 3 of 4 notices; closing one shows the 4th", async () => {
		await mount(<Four />);
		assert.deepEqual(shownIds(), ["a", "b", "c"]);
		assert.ok(card("d").hasAttribute("hidden"), "the waiting one is hidden, so a screen reader skips it");
		await close("b");
		assert.deepEqual(shownIds(), ["a", "c", "d"]);
	});

	it("two quiet spaces: one notice shows, the other waits", async () => {
		const quiet = (spaceId: string) => ({ spaceId, name: spaceId.toUpperCase(), folder: `/drive/${spaceId}`, lastAt: new Date(2026, 10, 1).toISOString() });
		const now = new Date(2026, 10, 6).getTime();
		function TwoQuiet() {
			const stack = useStack();
			return (
				<>
					<PillPanel>{null}</PillPanel>
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
		mock.timers.enable({ apis: ["setTimeout", "Date"] });
		try {
			let expired = 0;
			const onExpire = () => expired++;
			function ThreeAndDone() {
				const stack = useStack();
				return (
					<>
						<PillPanel>
							<Notices ids={["a", "b", "c"]} />
						</PillPanel>
						{stack && <DoneNotice text="Ticking that deadline done didn't save." onExpire={onExpire} />}
					</>
				);
			}
			await mount(<ThreeAndDone />);
			assert.ok(card("done-notice").hasAttribute("hidden"), "the 4th waits hidden");
			await act(async () => mock.timers.tick(10_000));
			assert.equal(expired, 0, "its time does not run while it waits");

			await close("b");
			assert.ok(!card("done-notice").hasAttribute("hidden"), "it shows once one closes");
			await act(async () => mock.timers.tick(5_000));
			assert.equal(expired, 0, "it stays its full time from when it showed");
			await act(async () => mock.timers.tick(1_500));
			assert.equal(expired, 1);
		} finally {
			mock.timers.reset();
		}
	});

	it("after 12 seconds a notice folds into the pill, and the open card shows it again", async () => {
		mock.timers.enable({ apis: ["setTimeout", "Date"] });
		try {
			let waiting = -1;
			function Count() {
				waiting = useNotices().waiting;
				return null;
			}
			await mount(
				<>
					<PillPanel>
						<Notices ids={["a"]} />
					</PillPanel>
					<Count />
				</>,
			);
			assert.ok(!panel().hasAttribute("inert"), "the panel is open while a notice shows by itself");
			await act(async () => mock.timers.tick(11_000));
			assert.deepEqual(shownIds(), ["a"]);
			await act(async () => mock.timers.tick(1_500));
			assert.deepEqual(shownIds(), []);
			assert.equal(waiting, 1, "the pill counts it");
			assert.ok(panel().hasAttribute("inert"), "and the panel closes");

			await act(async () => setNoticesOpen(true));
			assert.deepEqual(shownIds(), ["a"]);
			assert.equal(waiting, 0);
			await act(async () => setNoticesOpen(false));
			assert.deepEqual(shownIds(), [], "closing the card folds it again");
		} finally {
			mock.timers.reset();
		}
	});

	it("a notice that closes by itself never folds", async () => {
		mock.timers.enable({ apis: ["setTimeout", "Date"] });
		try {
			await mount(
				<PillPanel>
					<Notices ids={["a"]} timed />
				</PillPanel>,
			);
			await act(async () => mock.timers.tick(60_000));
			assert.deepEqual(shownIds(), ["a"]);
		} finally {
			mock.timers.reset();
		}
	});
});

describe("With a pill on screen", () => {
	function Pill() {
		usePillMounted();
		return <span data-testid="pill">{useNotices().said?.title}</span>;
	}
	const pillSays = () => document.querySelector('[data-testid="pill"]')!.textContent;

	it("the pill says the title of the notice that just came, so its card leaves the title out", async () => {
		await mount(
			<>
				<Pill />
				<PillPanel>
					<Notices ids={["a", "b"]} />
				</PillPanel>
			</>,
		);
		assert.equal(pillSays(), "Notice a");
		assert.equal(card("a").textContent, "OK");
		assert.equal(card("b").textContent, "Notice bOK", "the next one keeps its title");
	});

	it("a notice that is only a title shows on the pill alone, and its time still runs", async () => {
		await mount(
			<>
				<Pill />
				<PillPanel>
					<NoticeCard data-testid="bare" role="alert" timed title="Couldn't mark it done. Try again." />
				</PillPanel>
			</>,
		);
		assert.equal(pillSays(), "Couldn't mark it done. Try again.");
		assert.ok(panel().hasAttribute("inert"), "the panel has nothing to show, so it stays closed");
		assert.ok(!card("bare").hasAttribute("hidden"), "not hidden as a waiting notice is: its time runs");
		assert.ok(card("bare").className.split(" ").includes("hidden"), "but it draws nothing");
	});

	it("the open card shows every title", async () => {
		await mount(
			<>
				<Pill />
				<PillPanel>
					<Notices ids={["a"]} />
				</PillPanel>
			</>,
		);
		await act(async () => setNoticesOpen(true));
		assert.equal(pillSays(), "");
		assert.equal(card("a").textContent, "Notice aOK");
	});
});
