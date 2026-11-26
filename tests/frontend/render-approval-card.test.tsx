/**
 * A card on the lesson's desk for each thing the teacher waits for the learner to allow: the
 * server's sentence and its subject on a slip of paper, with Deny and Allow, which post the
 * answer once; it folds away when the server no longer lists it, it brings the desk back while
 * the teacher's words show, and one that comes under the window asks the page to show it.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ReadingPane } from "../../src/frontend/components/lesson/reading-pane.tsx";
import { AskShownContext } from "../../src/frontend/components/lesson/approval-card.tsx";
import { ChatActionsContext } from "../../src/frontend/components/chat-actions-context.ts";
import { NO_LESSON_WORK, readLessonWork, type LessonWork, type LhViewMessage, type WorkApproval } from "../../src/shared/core/index.ts";

const dom = parseHTML("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		disconnect() {}
	},
	requestAnimationFrame: (run: () => void) => setTimeout(run, 0),
	cancelAnimationFrame: (id: number) => clearTimeout(id),
});

describe("the work's approvals", () => {
	it("are read as the server words them, and one with no words is left out", () => {
		const work = readLessonWork({
			live: true,
			cause: "ask",
			steps: [],
			files: [],
			approvals: [
				{ id: "a1", text: "Claude wants to run this command.", subject: { kind: "command", text: "ls" } },
				{ id: "a2", text: "Claude wants to change files.", subject: null },
				{ id: "a3", text: "Claude wants to use this tool.", subject: { kind: "gadget", text: "x" } },
				{ id: "a4" },
				{ text: "No id." },
			],
		});
		assert.deepEqual(work.approvals, [
			{ id: "a1", text: "Claude wants to run this command.", subject: { kind: "command", text: "ls" } },
			{ id: "a2", text: "Claude wants to change files.", subject: null },
			{ id: "a3", text: "Claude wants to use this tool.", subject: null },
		]);
		assert.deepEqual(readLessonWork({ live: false, approvals: [{ id: "a1", text: "x", subject: null }] }).approvals, [], "none with no turn");
	});
});

describe("the approval card", () => {
	const card: LhViewMessage = { id: "card", role: "user", parts: [{ type: "data-space-context", data: { spaceId: "s", name: "Calculus", description: "", files: [] } }] };
	const first: LhViewMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Limits" }] };
	const bash: WorkApproval = { id: "a1", text: "Quigley wants to run this command.", subject: { kind: "command", text: "python3 plot.py" } };
	const work = (approvals: WorkApproval[], steps: LessonWork["steps"] = []): LessonWork => ({ ...NO_LESSON_WORK, live: true, cause: "ask", steps, approvals });
	type Props = React.ComponentProps<typeof ReadingPane>;
	const props = (over: Partial<Props> = {}): Props => ({
		spaceId: undefined,
		stepNumbers: new Map(),
		stepNames: new Map(),
		echo: -1,
		messages: [card, first],
		phases: [],
		status: "streaming",
		busy: true,
		stoppedEmpty: false,
		work: work([]),
		problemSheet: false,
		queuedSteers: [],
		arrivalsLive: true,
		pageMarks: new Map(),
		arrive: () => "lh-rise",
		onDesk: () => {},
		...over,
	});
	const actions = { chatId: "c 1", sendBlocked: null, sendText: () => {}, dropKept: () => {}, inTurn: null };
	const wait = (ms: number) => act(async () => void (await new Promise((done) => setTimeout(done, ms))));
	/** The cards that asked the page to show them. */
	const asked: HTMLElement[] = [];

	/** Renders the pane in a page whose posts are recorded; `answer` is what the server says to each. */
	async function page(run: (draw: (over: Partial<Props>) => Promise<void>, host: HTMLElement, posts: { url: string; body: unknown }[]) => Promise<void>, answer = () => Response.json({ ok: true })) {
		const posts: { url: string; body: unknown }[] = [];
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			posts.push({ url: String(input), body: JSON.parse(String(init?.body)) });
			return answer();
		}) as typeof fetch;
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		const draw = (over: Partial<Props>) =>
			act(async () =>
				root.render(
					<ChatActionsContext.Provider value={actions}>
						<AskShownContext.Provider value={(card) => void asked.push(card)}>
							<ReadingPane {...props(over)} />
						</AskShownContext.Provider>
					</ChatActionsContext.Provider>,
				),
			);
		try {
			await run(draw, host, posts);
		} finally {
			await act(async () => root.unmount());
			host.remove();
			globalThis.fetch = realFetch;
		}
	}

	it("lies on the desk under the steps, says what will run, and Allow posts the answer once", async () => {
		await page(async (draw, host, posts) => {
			await draw({ work: work([bash], [{ id: "s1", at: "2026-11-23T22:20:33.000Z", text: "Reading notes.md", call: null, reads: null }]) });
			const desk = host.querySelector("[data-testid=agent-at-work]");
			const shown = host.querySelector("[data-testid=approval-card]");
			assert.ok(shown !== null && desk?.contains(shown) === true, "on the desk");
			assert.match(desk?.textContent ?? "", /Reading notes\.md[\s\S]*Quigley wants to run this command\.[\s\S]*python3 plot\.py[\s\S]*Deny[\s\S]*Allow/, "under the steps, Deny before Allow");
			const subject = shown.querySelector("[data-testid=approval-subject]");
			assert.equal(subject?.getAttribute("data-kind"), "command");
			assert.match(subject?.className ?? "", /lh-paper[\s\S]*font-mono/, "the command on a slip of paper, in the agent's own type");
			const allow = host.querySelector<HTMLButtonElement>("[data-testid=approval-allow]")!;
			await act(async () => {
				allow.click();
				allow.click();
			});
			assert.deepEqual(posts, [{ url: "/api/chats/c%201/approvals/a1", body: { allow: true } }], "once, to the approval's own address");
		});
	});

	it("Deny posts allow false, and a failed answer says why on the card", async () => {
		await page(
			async (draw, host, posts) => {
				await draw({ work: work([bash]) });
				await act(async () => host.querySelector<HTMLButtonElement>("[data-testid=approval-deny]")!.click());
				assert.deepEqual(posts.map((p) => p.body), [{ allow: false }]);
				assert.match(host.querySelector("[data-testid=approval-card] [role=alert]")?.textContent ?? "", /no permission question waits/);
				assert.equal(host.querySelector<HTMLButtonElement>("[data-testid=approval-deny]")!.disabled, false, "the keys work again");
			},
			() => Response.json({ error: "no permission question waits by that id" }, { status: 404 }),
		);
	});

	it("opens its room as it comes, and folds away once the server no longer lists it", async () => {
		await page(async (draw, host) => {
			await draw({ work: work([]) });
			assert.ok(host.querySelector("[data-testid=approval-card]") === null);
			await draw({ work: work([bash]) });
			await wait(40);
			const shown = host.querySelector("[data-testid=approval-card]");
			assert.ok(shown !== null, "it came");
			assert.equal(shown.closest(".lh-collapse")?.getAttribute("data-state"), "open", "its room opened");
			assert.match(shown.className, /lh-fade/, "and it faded in");
			await draw({ work: work([]) });
			assert.ok(host.querySelector("[data-testid=approval-card]") === shown, "still there as it leaves");
			assert.equal(shown.getAttribute("data-state"), "closed", "fading out");
			assert.equal(shown.closest(".lh-collapse")?.getAttribute("data-state"), "closed", "and folding shut");
			assert.equal(shown.hasAttribute("inert"), true, "no key works while it goes");
			await wait(220);
			assert.ok(host.querySelector("[data-testid=approval-card]") === null, "then gone");
			assert.ok(host.querySelector("[data-testid=agent-at-work]") !== null, "the desk stays");
		});
	});

	it("is simply there on a desk that opens with it, with no motion, and moves no page", async () => {
		asked.length = 0;
		await page(async (draw, host) => {
			await draw({ work: work([bash]), arrive: () => undefined });
			const shown = host.querySelector("[data-testid=approval-card]");
			assert.equal(shown?.closest(".lh-collapse")?.getAttribute("data-state"), "open");
			assert.doesNotMatch(shown?.className ?? "", /lh-fade/);
			assert.deepEqual(asked, []);
		});
	});

	it("asks the page to show it once when it comes", async () => {
		asked.length = 0;
		await page(async (draw, host) => {
			await draw({ work: work([]) });
			await draw({ work: work([bash]) });
			await wait(40);
			await draw({ work: work([bash]) });
			assert.equal(asked.length, 1, "once");
			assert.ok(asked[0] === host.querySelector("[data-testid=approval-card]"), "with the card itself");
		});
	});

	it("brings the desk back while the teacher's words show, and the words stay", async () => {
		await page(async (draw, host) => {
			const words = [card, first, { id: "a", role: "assistant", parts: [{ type: "text", text: "Let me draw it." }] } as LhViewMessage];
			await draw({ work: work([]) });
			await draw({ messages: words, work: work([]) });
			await wait(450);
			await wait(200);
			assert.ok(host.querySelector("[data-testid=agent-at-work]") === null, "the words took the desk's place");
			await draw({ messages: words, work: work([bash]) });
			assert.ok(host.querySelector("[data-testid=agent-at-work] [data-testid=approval-card]") !== null, "the desk is back with the card");
			assert.match(host.querySelector(".lh-source-passage")?.textContent ?? "", /Let me draw it\./);
			await draw({ messages: words, work: work([]) });
			await wait(220);
			assert.ok(host.querySelector("[data-testid=agent-at-work]") !== null, "answered, the desk waits for the teacher's next words");
		});
	});
});
