/**
 * The strip's peek and its notices: at most 3 notices show, update and
 * restart first, one quiet notice (a gap card) at a time; the rest wait, hidden,
 * until one closes, and a waiting notice's time starts once it shows. A
 * notice keeps its own title and close key, folds into the strip after a
 * while and comes back when the peek's count asks for it. The peek is out
 * while a notice shows or the learner asked for it. Time stands still while
 * the pointer or keyboard focus is on the peek. The strip itself draws
 * what the teacher says. Mounted over linkedom.
 */
import React, { act, useEffect, useState } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { TeacherApi } from "../../src/frontend/components/teacher/teacher-context.ts";

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
const { createPortal } = await import("react-dom");
const { MemoryRouter, RouterProvider, createMemoryRouter } = await import("react-router");
const { TeacherContext } = await import("../../src/frontend/components/teacher/teacher-context.ts");
const { AgentStatusContext } = await import("../../src/frontend/components/agent-status.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { PeekSheet, PEEK_ROWS_ID } = await import("../../src/frontend/components/strip/peek-sheet.tsx");
const { Strip } = await import("../../src/frontend/components/strip/strip.tsx");
const { peekKeyboard, stripPointer, tuckPeek } = await import("../../src/frontend/components/strip/peek-store.ts");
const { NoticeCard } = await import("../../src/frontend/components/notice-card.tsx");
const { coverNotices, setNoticesOpen, useNotices } = await import("../../src/frontend/components/notice-store.ts");
const { PRESENT_MS } = await import("../../src/frontend/components/notice-stack-model.ts");
const { GapCard } = await import("../../src/frontend/components/gap-card.tsx");
const { DoneNotice } = await import("../../src/frontend/components/done-notice.tsx");

/** The notice stack's id in the page (peek-sheet.tsx). */
const NOTICE_STACK_ID = "lh-notices";

let root: Root | undefined;
afterEach(async () => {
	await act(async () => root?.unmount());
	await act(async () => {
		setNoticesOpen(false);
		coverNotices(false);
		peekKeyboard(false);
		stripPointer(false);
		tuckPeek();
	});
	document.body.innerHTML = "";
	document.documentElement.removeAttribute("data-tab-focus");
});

const mount = async (node: React.ReactNode) => {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => root!.render(<MemoryRouter>{node}</MemoryRouter>));
};
const cards = (selector: string) => [...document.querySelectorAll(`#${NOTICE_STACK_ID} > ${selector}`)];
const card = (id: string) => cards(`[data-testid="${id}"]`)[0] as HTMLElement;
const peek = () => document.querySelector('[data-testid="peek"]')!;
const peekIsOut = () => peek().getAttribute("data-state") === "open" && !peek().hasAttribute("inert");
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

/** Two notices inside the peek and two portaled into it, as DoneNotice is. */
function Four() {
	const stack = useStack();
	return (
		<>
			<PeekSheet>
				<Notices ids={["a", "b"]} />
			</PeekSheet>
			{stack && createPortal(<Notices ids={["c", "d"]} />, stack)}
		</>
	);
}

describe("The notices in the peek", () => {
	it("shows 3 of 4 notices; closing one shows the 4th", async () => {
		await mount(<Four />);
		assert.deepEqual(shownIds(), ["a", "b", "c"]);
		assert.ok(card("d").hasAttribute("hidden"), "the waiting one is hidden, so a screen reader skips it");
		await close("b");
		assert.deepEqual(shownIds(), ["a", "c", "d"]);
	});

	it("two gap cards: one notice shows, the other waits", async () => {
		const gap = (spaceId: string) => ({ spaceId, key: `${spaceId}:ddl_a:recent`, title: `Nothing coming up in ${spaceId}`, line: "Test 2 was the last, 2 days ago.", answer: "Nothing new", close: false });
		function TwoGaps() {
			const stack = useStack();
			return (
				<>
					<PeekSheet>{null}</PeekSheet>
					{stack && createPortal(
						<>
							<GapCard gap={gap("spc_cse21")} onUpdate={() => {}} />
							<GapCard gap={gap("spc_cse29")} onUpdate={() => {}} />
						</>,
						stack,
					)}
				</>
			);
		}
		await mount(<TwoGaps />);
		const notices = cards('[data-testid="gap-notice"]');
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
						<PeekSheet>
							<Notices ids={["a", "b", "c"]} />
						</PeekSheet>
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

	it("after 12 seconds a notice folds into the strip, and asking for the count shows it again", async () => {
		mock.timers.enable({ apis: ["setTimeout", "Date"] });
		try {
			let waiting = -1;
			function Count() {
				waiting = useNotices().waiting;
				return null;
			}
			await mount(
				<>
					<PeekSheet>
						<Notices ids={["a"]} />
					</PeekSheet>
					<Count />
				</>,
			);
			assert.ok(peekIsOut(), "the peek is out while a notice shows by itself");
			await act(async () => mock.timers.tick(11_000));
			assert.deepEqual(shownIds(), ["a"]);
			await act(async () => mock.timers.tick(PRESENT_MS - 11_000 + 500));
			assert.deepEqual(shownIds(), []);
			assert.equal(waiting, 1, "the strip counts it");
			assert.ok(!peekIsOut(), "and the peek goes");

			await act(async () => setNoticesOpen(true));
			assert.deepEqual(shownIds(), ["a"]);
			assert.ok(peekIsOut());
			assert.equal(waiting, 1, "the count stays while the card shows it");
			await act(async () => setNoticesOpen(false));
			assert.deepEqual(shownIds(), [], "folding it again");
		} finally {
			mock.timers.reset();
		}
	});

	it("folding the peek also folds a notice that still shows by itself", async () => {
		mock.timers.enable({ apis: ["setTimeout", "Date"] });
		try {
			let waiting = -1;
			function Count() {
				waiting = useNotices().waiting;
				return null;
			}
			await mount(
				<>
					<PeekSheet>
						<Notices ids={["a"]} />
					</PeekSheet>
					<Count />
				</>,
			);
			assert.deepEqual(shownIds(), ["a"]);
			await act(async () => setNoticesOpen(false));
			assert.deepEqual(shownIds(), []);
			assert.equal(waiting, 1);
		} finally {
			mock.timers.reset();
		}
	});

	it("under the teacher's open panel no notice shows by itself: it waits folded in the strip's count", async () => {
		let waiting = -1;
		function Count() {
			waiting = useNotices().waiting;
			return null;
		}
		await mount(
			<>
				<PeekSheet>
					<Notices ids={["a"]} />
				</PeekSheet>
				<Count />
			</>,
		);
		assert.deepEqual(shownIds(), ["a"]);
		await act(async () => coverNotices(true));
		assert.deepEqual(shownIds(), []);
		assert.equal(waiting, 1);
		await act(async () => coverNotices(false));
		assert.deepEqual(shownIds(), ["a"], "the panel closed: it shows again");
	});

	it("a notice that closes by itself never folds", async () => {
		mock.timers.enable({ apis: ["setTimeout", "Date"] });
		try {
			await mount(
				<PeekSheet>
					<Notices ids={["a"]} timed />
				</PeekSheet>,
			);
			await act(async () => mock.timers.tick(60_000));
			assert.deepEqual(shownIds(), ["a"]);
		} finally {
			mock.timers.reset();
		}
	});
});

describe("A notice's own card", () => {
	it("keeps its title and close key while it shows by itself, one below another", async () => {
		await mount(
			<PeekSheet>
				<Notices ids={["a", "b"]} />
			</PeekSheet>,
		);
		assert.equal(card("a").textContent, "Notice aOK");
		assert.equal(card("b").textContent, "Notice bOK");
	});

	it("keeps its title after the folded ones were asked for", async () => {
		await mount(
			<PeekSheet>
				<Notices ids={["a"]} />
			</PeekSheet>,
		);
		await act(async () => setNoticesOpen(true));
		assert.equal(card("a").textContent, "Notice aOK");
	});

	it("a notice that is only a title shows that title, and its time still runs", async () => {
		await mount(
			<PeekSheet>
				<NoticeCard data-testid="bare" role="alert" timed title="Couldn't mark it done. Try again." />
			</PeekSheet>,
		);
		assert.equal(card("bare").textContent, "Couldn't mark it done. Try again.");
		assert.ok(!card("bare").hasAttribute("hidden"));
		assert.ok(peekIsOut());
	});
});

describe("The peek", () => {
	const afterExit = () => act(async () => new Promise<void>((done) => setTimeout(done, 200)));

	it("holds the rows' host before the notice stack", async () => {
		await mount(
			<PeekSheet>
				<Notices ids={["a"]} />
			</PeekSheet>,
		);
		const rows = peek().querySelector(`#${PEEK_ROWS_ID}`);
		assert.ok(rows, "the rows host is inside the peek");
		assert.equal(rows.nextElementSibling?.id, NOTICE_STACK_ID, "the notices come under the rows");
	});

	it("is closed and inert with no notice and nothing asked for", async () => {
		await mount(<PeekSheet>{null}</PeekSheet>);
		assert.equal(peek().getAttribute("data-state"), "closed");
		assert.ok(peek().hasAttribute("inert"));
	});

	it("is shown while a notice is up, and closes when it goes", async () => {
		await mount(
			<PeekSheet>
				<Notices ids={["a"]} />
			</PeekSheet>,
		);
		assert.ok(peekIsOut());
		assert.equal(peek().getAttribute("data-lh-menu"), "quiet", "it came by itself: Find still opens");
		await close("a");
		assert.ok(!peekIsOut());
		assert.equal(peek().getAttribute("data-state"), "closed");
		await afterExit();
		assert.ok(peek().className.split(" ").includes("invisible"), "gone once its exit played");
	});

	it("is shown while the learner asked for it, with no notice, and tucks away again", async () => {
		await mount(<PeekSheet>{null}</PeekSheet>);
		await act(async () => peekKeyboard(true));
		assert.ok(peekIsOut());
		assert.equal(peek().getAttribute("data-lh-menu"), "", "asked for: a menu in front of the page");
		assert.ok(!peek().className.split(" ").includes("invisible"));
		await act(async () => tuckPeek());
		assert.ok(!peekIsOut());
	});
});

describe("Time stands still while the peek is held", () => {
	const fire = (target: Element, type: string) => act(async () => void target.dispatchEvent(new dom.window.Event(type, { bubbles: true })));
	const withOneNotice = () =>
		mount(
			<PeekSheet>
				<Notices ids={["a"]} />
			</PeekSheet>,
		);
	const timers = async (run: () => Promise<void>) => {
		mock.timers.enable({ apis: ["setTimeout", "Date"] });
		try {
			await run();
		} finally {
			mock.timers.reset();
		}
	};

	it("a held notice stays past a minute, and folds 6 seconds after the release", () =>
		timers(async () => {
			await withOneNotice();
			await act(async () => mock.timers.tick(6_000));
			await fire(peek(), "pointerover");
			await act(async () => mock.timers.tick(60_000));
			assert.deepEqual(shownIds(), ["a"]);
			await fire(peek(), "pointerout");
			await act(async () => mock.timers.tick(5_900));
			assert.deepEqual(shownIds(), ["a"]);
			await act(async () => mock.timers.tick(200));
			assert.deepEqual(shownIds(), []);
		}));

	it("a hold at 11 seconds leaves 3 seconds after the release", () =>
		timers(async () => {
			await withOneNotice();
			await act(async () => mock.timers.tick(11_000));
			await fire(peek(), "pointerover");
			await act(async () => mock.timers.tick(5_000));
			await fire(peek(), "pointerout");
			await act(async () => mock.timers.tick(2_900));
			assert.deepEqual(shownIds(), ["a"]);
			await act(async () => mock.timers.tick(200));
			assert.deepEqual(shownIds(), []);
		}));

	it("a clicked key keeps focus but holds nothing; keyboard focus holds until it leaves", () =>
		timers(async () => {
			await withOneNotice();
			const clicked = document.querySelector('[data-testid="close-a"]')!;
			await fire(clicked, "pointerdown");
			await fire(clicked, "focusin");
			await act(async () => mock.timers.tick(PRESENT_MS + 100));
			assert.deepEqual(shownIds(), [], "a click held nothing");

			await act(async () => root!.unmount());
			await withOneNotice();
			const key = document.querySelector('[data-testid="close-a"]')!;
			document.documentElement.setAttribute("data-tab-focus", "");
			try {
				await fire(key, "focusin");
				await act(async () => mock.timers.tick(60_000));
				assert.deepEqual(shownIds(), ["a"], "keyboard focus holds");
				await fire(key, "focusout");
				await act(async () => mock.timers.tick(PRESENT_MS + 100));
				assert.deepEqual(shownIds(), [], "focus left the peek");
			} finally {
				document.documentElement.removeAttribute("data-tab-focus");
			}
		}));
});

describe("A notice's close key", () => {
	it("closes the card without opening what a click on the card opens", async () => {
		const clicks: string[] = [];
		await mount(
			<PeekSheet>
				<NoticeCard data-testid="a" role="status" title="Notice a" close={{ onClick: () => clicks.push("close"), testId: "a-close" }} onClick={() => clicks.push("card")}>
					<p>What changed</p>
				</NoticeCard>
			</PeekSheet>,
		);
		assert.ok(card("a").textContent!.includes("Notice a"), "the title is on the card");
		const key = card("a").querySelector('[data-testid="a-close"]') as HTMLElement;
		assert.ok(key);
		await act(async () => key.click());
		assert.deepEqual(clicks, ["close"]);
	});
});

describe("The strip", () => {
	const TEACHING = { connected: false, turnsRunning: 0 };
	const api = (over: Partial<TeacherApi> = {}): TeacherApi => ({
		name: "Ada",
		follow: false,
		setFollow: () => {},
		panelOpen: false,
		setPanelOpen: () => {},
		showChat: () => {},
		talk: { chats: [], chatId: null },
		waiting: { lessons: [], talk: null },
		canAsk: false,
		ask: () => {},
		asking: null,
		recent: [],
		doing: null,
		setLesson: () => {},
		go: () => {},
		slip: null,
		offer: null,
		held: false,
		spaceNameOf: () => null,
		...over,
	});

	/** Server events the strip hears, fired by name. */
	const listeners = new Map<string, (raw: string) => void>();
	const fire = (name: string, payload: unknown) => act(async () => void listeners.get(name)?.(JSON.stringify(payload)));
	const connect = () => ({
		close() {},
		onOpen() {},
		onEvent: (name: string, cb: (raw: string) => void) => void listeners.set(name, cb),
	});
	const realFetch = globalThis.fetch;
	let router: ReturnType<typeof createMemoryRouter>;
	afterEach(() => {
		globalThis.fetch = realFetch;
		listeners.clear();
	});

	async function mountStrip(teacher: TeacherApi | null, { agent = true, notices = false }: { agent?: boolean; notices?: boolean } = {}) {
		globalThis.fetch = (async () => Response.json({ chats: [{ id: "c1", title: "Counting" }] })) as typeof fetch;
		const page = (
			<ServerEventsProvider connect={connect as never}>
				<AgentStatusContext.Provider value={agent ? TEACHING : null}>
					<TeacherContext.Provider value={teacher}>
						<Strip />
						<PeekSheet>{notices && <Notices ids={["a"]} />}</PeekSheet>
					</TeacherContext.Provider>
				</AgentStatusContext.Provider>
			</ServerEventsProvider>
		);
		router = createMemoryRouter([{ path: "*", element: page }], { initialEntries: ["/"] });
		const host = document.createElement("div");
		document.body.append(host);
		root = createRoot(host);
		await act(async () => root!.render(<RouterProvider router={router} />));
	}
	const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
	const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))));

	it("draws nothing outside the app shell, where no teacher is", async () => {
		await mountStrip(null);
		assert.equal(q("strip"), null);
		assert.equal(document.querySelector("[data-strip]"), null);
	});

	it("is a button with the teacher's name, expanded as the panel is", async () => {
		await mountStrip(api());
		assert.equal(q("strip")!.textContent!.includes("Ada"), true);
		assert.equal(q("strip")!.getAttribute("aria-expanded"), "false");
		assert.equal(q("strip")!.getAttribute("aria-label"), "Ada. Ready");
		await act(async () => root!.unmount());
		await mountStrip(api({ panelOpen: true }));
		assert.equal(q("strip")!.getAttribute("aria-expanded"), "true");
		assert.equal(q("strip")!.getAttribute("aria-label"), "Ada", "the open panel's head says the status");
		assert.equal(q("strip")!.textContent!.includes("Ada"), false, "the open panel's head names the teacher");
	});

	it("marks nothing at rest: no flag, no count", async () => {
		await mountStrip(api());
		assert.equal(q("strip-flag"), null);
		assert.equal(q("strip-waiting"), null);
		assert.equal(q("strip-due"), null);
	});

	it("a click opens the panel, and closes it again", async () => {
		const opened: boolean[] = [];
		await mountStrip(api({ setPanelOpen: (open) => void opened.push(open) }));
		await act(async () => q("strip")!.click());
		await act(async () => root!.unmount());
		await mountStrip(api({ panelOpen: true, setPanelOpen: (open) => void opened.push(open) }));
		await act(async () => q("strip")!.click());
		assert.deepEqual(opened, [true, false]);
	});

	it("says your turn once a reply waits in another lesson, and its peek row opens that lesson", async () => {
		await mountStrip(api());
		await fire("turn-settled", { chatId: "c1" });
		await settle();
		assert.equal(q("strip-flag")!.textContent, "your turn");
		assert.equal(q("strip")!.getAttribute("aria-label"), "Ada. Ready. your turn");

		await act(async () => peekKeyboard(true));
		const row = q("peek-ready")!;
		assert.ok(row.textContent!.includes("Counting"));
		await act(async () => q("peek-open")!.click());
		assert.equal(router.state.location.pathname, "/chat/c1");
		await settle();
		assert.equal(q("strip-flag"), null, "the lesson is open: nothing waits");
		assert.ok(!peekIsOut(), "the peek tucks away");
	});

	it("the peek's status row is the strip's click", async () => {
		const opened: boolean[] = [];
		await mountStrip(api({ setPanelOpen: (open) => void opened.push(open) }));
		await act(async () => peekKeyboard(true));
		assert.equal(q("peek-status")!.textContent, "Ready");
		await act(async () => q("peek-status")!.click());
		assert.deepEqual(opened, [true]);
	});

	it("counts the folded notices, and the peek's row asks for them", async () => {
		mock.timers.enable({ apis: ["setTimeout", "Date"] });
		try {
			await mountStrip(api(), { notices: true });
			await act(async () => mock.timers.tick(PRESENT_MS + 500));
			assert.equal(q("strip-waiting")!.textContent, "1");
			assert.deepEqual(shownIds(), []);
			await act(async () => peekKeyboard(true));
			assert.equal(q("peek-notices")!.textContent, "1 notice");
			await act(async () => q("peek-notices")!.click());
			assert.deepEqual(shownIds(), ["a"]);
			assert.equal(q("peek-notices")!.getAttribute("aria-expanded"), "true");
		} finally {
			mock.timers.reset();
		}
	});
});
