/**
 * The teacher's panel as the strip and the status line open it: what opens it by itself (a card in
 * its chat waiting to be allowed), who gets the keyboard, a new learner's first look at Home, a line
 * a page key hands the teacher, the chat in a window of its own (Pop out, Put back), and the web
 * version, which has no windows. The chat's own screens are in render-talk-chat.test.tsx.
 */
import { dom, fakeShell } from "../terminal-dom.ts";
import { stubCodeMirrorDom } from "../math-box-dom.ts";
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { TerminalRecord } from "../../src/frontend/components/terminal/terminal-model.ts";
import type { TeacherApi } from "../../src/frontend/components/teacher/teacher-context.ts";
import { WELCOME_KEY } from "../../src/frontend/components/teacher/panel-auto-model.ts";
import { readStorage, writeStorage } from "../../src/frontend/lib/storage.ts";

const { MemoryRouter } = await import("react-router");
const { TerminalsProvider, useTerminals } = await import("../../src/frontend/components/terminal/use-terminals.ts");
const { TeacherStatus } = await import("../../src/frontend/components/terminal/teacher-status.tsx");
const { RestartDialog } = await import("../../src/frontend/components/terminal/restart-dialog.tsx");
const { AgentNeed } = await import("../../src/frontend/components/onboarding/agent-need.tsx");
const { TeacherPanel } = await import("../../src/frontend/components/teacher/teacher-panel.tsx");
const { TeacherContext } = await import("../../src/frontend/components/teacher/teacher-context.ts");
const { useTeacherPanel } = await import("../../src/frontend/components/teacher/use-teacher-panel.ts");
const { panelBody } = await import("../../src/frontend/components/teacher/dock-model.ts");
const { ChatWindow } = await import("../../src/frontend/components/teacher/chat-window.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { AgentFolderProvider } = await import("../../src/frontend/components/agent-folder/agent-folder-context.tsx");
type Access = Parameters<typeof TerminalsProvider>[0]["status"];

// The chat's writing box is CodeMirror.
stubCodeMirrorDom(dom);

const access = (over: Partial<NonNullable<Access>> = {}): Access => ({ connected: false, turnsRunning: 0, terminals: [], outsideHere: false, ...over });
const teacher = (over: Partial<TerminalRecord> = {}): TerminalRecord => ({ id: "t1", agent: "claude", startedAt: Date.now(), ended: null, prompt: null, url: false, ...over });
const FOLDER = { folder: "/home/ada/godspeed", short: "~/godspeed", exists: true, commands: { claude: "claude", codex: "codex" }, startCommands: {}, oldSetup: { plugin: false, codex: false }, agent: "claude" as string | null, model: {} };

const realFetch = globalThis.fetch;
const stored = new Map<string, string>();
/** The chats the panel's box made: each POST /api/chats body. */
let made: { kind?: string; text?: string }[] = [];
beforeEach(() => {
	stored.clear();
	made = [];
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v), removeItem: (k: string) => void stored.delete(k) },
	});
	// The Activity list asks for the open space's graph costs: none here. The folder keeps the agent a pick (PATCH) sends.
	let folder = FOLDER;
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		if (url.startsWith("/api/graph/costs")) return new Response(null, { status: 404 });
		if (url === "/api/chats" && init?.method === "POST") {
			made.push(JSON.parse(String(init.body)));
			return Response.json({ id: "chat_new" });
		}
		if (init?.method === "PATCH") folder = { ...folder, agent: JSON.parse(String(init.body)).agent };
		return Response.json(folder);
	}) as unknown as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

/** Whether the page the host stands for is Home. */
let onHome = false;
/** A card in the panel's chat waits to be allowed when the host first shows. */
let needAtStart = false;

/** The teacher's panel as the provider holds it; the "need" keys stand for a card in its chat. */
function PanelHost({ children }: { children?: React.ReactNode }) {
	const [need, setNeed] = React.useState(needAtStart);
	const panel = useTeacherPanel(null, onHome, need, true);
	const [line, setLine] = React.useState<string | null>(null);
	// The provider clears a line when the panel closes unsent.
	React.useEffect(() => {
		if (!panel.open) setLine(null);
	}, [panel.open]);
	const terminals = useTerminals();
	const view = panelBody(!!terminals?.popped);
	const popOut = terminals?.popOut;
	const api: TeacherApi = {
		name: "Ada",
		follow: false,
		setFollow: () => {},
		panelOpen: panel.open,
		setPanelOpen: panel.setOpen,
		showChat: () => panel.showChat(),
		talk: { chats: [], chatId: null },
		waiting: { lessons: [], talk: null },
		canAsk: !terminals?.popped,
		ask: (l) => {
			setLine(l);
			panel.showChat();
		},
		asking: line === null ? null : { line, clear: () => setLine(null) },
		recent: [],
		doing: null,
		setLesson: () => {},
		go: () => {},
		slip: null,
		offer: null,
		held: false,
		spaceNameOf: () => null,
	};
	return (
		<TeacherContext.Provider value={api}>
			<TeacherStatus name="Ada" line="Ready" testid="status" />
			<button type="button" data-testid="open-panel" onClick={() => panel.setOpen(true)} />
			<button type="button" data-testid="open-chat" onClick={() => panel.showChat()} />
			<button type="button" data-testid="ask-find" onClick={() => api.ask("Find sums in my files")} />
			<button type="button" data-testid="close-panel" onClick={() => panel.setOpen(false)} />
			<button type="button" data-testid="need-on" onClick={() => setNeed(true)} />
			<button type="button" data-testid="need-off" onClick={() => setNeed(false)} />
			{children}
			{panel.open && (
				<TeacherPanel
					name="Ada"
					view={view}
					chat={{ id: null, row: null, show() {} }}
					asking={api.asking}
					popOut={popOut ? () => popOut("Ada") : null}
					putBack={terminals?.putBack ?? null}
					list={panel.list}
					onList={panel.setList}
					focus={panel.focus}
					state="open"
					onBeside={() => {}}
				/>
			)}
		</TeacherContext.Provider>
	);
}

const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));
const q = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const text = (testid: string) => q(testid)?.textContent ?? null;
const click = async (testid: string) => {
	const el = q(testid);
	assert.ok(el !== null, `${testid} shows`);
	await act(async () => el.click());
	await settle();
};

/** The server's events the page listens for. */
const noEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });

async function mounted(status: Access, run: (render: (s: Access, extra?: React.ReactNode) => Promise<void>) => Promise<void>, extra?: React.ReactNode) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const render = async (s: Access, more: React.ReactNode = extra) => {
		await act(async () =>
			root.render(
				<MemoryRouter>
					<ServerEventsProvider connect={noEvents as never}>
						<AgentFolderProvider>
							<TerminalsProvider status={s}>
								<PanelHost>{more}</PanelHost>
							</TerminalsProvider>
						</AgentFolderProvider>
					</ServerEventsProvider>
				</MemoryRouter>,
			),
		);
		await settle();
	};
	try {
		await render(status);
		await run(render);
	} finally {
		await act(async () => root.unmount());
		await settle();
		host.remove();
	}
}

describe("the web version", () => {
	it("has no windows: the status line is plain text and the panel is the chat with no Pop out", async () => {
		delete (dom.window as { lh?: unknown }).lh;
		await mounted(access(), async () => {
			const status = q("status");
			assert.ok(status?.tagName === "SPAN", "plain text, not a button");
			assert.equal(status?.textContent, "Ready");
			await click("open-panel");
			assert.ok(q("talk-chat") !== null, "the chat is the panel's body");
			assert.ok(q("teacher-panel-pop-out") === null && q("teacher-panel-put-back") === null, "no window to move it to");
		});
	});
});

describe("the status line", () => {
	it("says what the teacher's own agent needs, and a click there opens the panel on its chat", async () => {
		const shell = fakeShell([teacher({ prompt: "trust" })]);
		try {
			await mounted(access(), async () => {
				assert.equal(text("status"), "Ada asks to trust its folder.");
				assert.ok(q("teacher-panel") === null, "the panel stays shut");
				await click("status");
				assert.ok(q("talk-chat") !== null, "the chat shows, not the agent's screen");
				assert.ok(document.querySelector("[data-terminal-screen]") === null);
			});
		} finally {
			shell.remove();
		}
	});
});

describe("opening by itself", () => {
	it("a card that waits in the chat opens the panel; settled, the panel it opened goes, but one the learner opened stays", async () => {
		await mounted(access(), async () => {
			assert.ok(q("teacher-panel") === null);
			await click("need-on");
			assert.ok(q("teacher-panel") !== null, "the card opened it");
			await click("need-off");
			assert.ok(q("teacher-panel") === null, "settled: it went");
			await click("open-chat");
			await click("need-on");
			await click("need-off");
			assert.ok(q("teacher-panel") !== null, "the learner opened it, so it stays");
		});
	});

	it("a panel the learner closed does not come back for a card that was already there", async () => {
		needAtStart = true;
		try {
			await mounted(access(), async () => {
				assert.ok(q("teacher-panel") === null, "a card there at the start is no change");
				await click("open-chat");
				await click("close-panel");
				await act(() => new Promise((r) => setTimeout(r, 150)));
				assert.ok(q("teacher-panel") === null);
			});
		} finally {
			needAtStart = false;
		}
	});

	it("the box takes the keyboard when the learner opens the panel, and not when a card does", async () => {
		const proto = dom.window.HTMLElement.prototype as { focus: () => void };
		const realFocus = proto.focus;
		let focused = 0;
		proto.focus = () => void focused++;
		try {
			await mounted(access(), async () => {
				await click("need-on");
				assert.ok(q("teacher-panel") !== null);
				assert.equal(focused, 0, "opened by itself: the keys stay where they were");
				await click("close-panel");
				await click("open-chat");
				assert.ok(focused > 0, "opened by the learner: the box takes them");
			});
		} finally {
			proto.focus = realFocus;
		}
	});
});

describe("onboarding", () => {
	it("a step after the agent step says what the teacher needs, and its button shows the screen there without the keyboard", async () => {
		const shell = fakeShell([teacher()]);
		const proto = dom.window.HTMLElement.prototype as { focus: () => void };
		const realFocus = proto.focus;
		let focused = 0;
		proto.focus = () => void focused++;
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		const status = access({ terminals: [{ id: "t1", here: true }] });
		function Step() {
			const [open, setOpen] = React.useState(false);
			return <AgentNeed open={open} onOpen={() => setOpen(true)} />;
		}
		const page = (done: boolean) => (
			<MemoryRouter>
				<ServerEventsProvider connect={noEvents as never}>
					<TerminalsProvider status={status}>{done ? <PanelHost /> : <Step />}</TerminalsProvider>
				</ServerEventsProvider>
			</MemoryRouter>
		);
		try {
			await act(async () => root.render(page(false)));
			await settle();
			assert.ok(q("onboarding-agent-need") === null, "nothing while it needs nothing");
			await act(async () => shell.push({ id: "t1", ended: null, prompt: "trust", url: false }));
			await settle();
			assert.equal(text("onboarding-agent-need"), "Claude Code asks to trust its folder.Show its screen");
			await click("onboarding-agent-need-show");
			for (let i = 0; i < 10 && !document.querySelector("[data-terminal-screen] textarea"); i++) await settle();
			assert.ok(q("first-run-screen") !== null, "the screen shows in the step");
			assert.ok(focused === 0, "no focus until a click in it");
			await act(async () => root.render(page(true)));
			await settle();
			assert.ok(q("teacher-panel") === null, "the panel stays shut after onboarding");
		} finally {
			proto.focus = realFocus;
			await act(async () => root.unmount());
			await settle();
			host.remove();
			shell.remove();
		}
	});
});

describe("a new learner's first look at Home", () => {
	it("opens the panel once, by itself, on its chat with what to ask in front of them; never for anyone else or on another page", async () => {
		const ready = access();
		try {
			await mounted(ready, async () => assert.ok(q("teacher-panel") === null, "no mark: nobody just finished onboarding"));
			writeStorage(WELCOME_KEY, "1");
			await mounted(ready, async () => assert.ok(q("teacher-panel") === null, "not Home"));
			assert.equal(readStorage(WELCOME_KEY), "1", "it still waits for Home");
			onHome = true;
			await mounted(ready, async () => {
				assert.ok(q("talk-chat") !== null);
				assert.ok(document.querySelectorAll('[data-testid="talk-starter"]').length > 0, "with what to ask in front of them");
			});
			assert.equal(readStorage(WELCOME_KEY), null);
			await mounted(ready, async () => assert.ok(q("teacher-panel") === null, "once"));
		} finally {
			onHome = false;
			writeStorage(WELCOME_KEY, null);
		}
	});
});

describe("a line a page key hands the teacher", () => {
	it("opens the panel on its chat and starts a chat with the line once, never again", async () => {
		await mounted(access(), async (render) => {
			assert.ok(q("teacher-panel") === null);
			await click("ask-find");
			assert.ok(q("teacher-panel") !== null, "the panel opens");
			assert.deepEqual(made, [{ kind: "talk", text: "Find sums in my files" }]);
			await render(access());
			assert.equal(made.length, 1, "not again");
		});
	});
});

describe("Restart now during a turn", () => {
	it("asks first, in the teacher's name", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		let restarted = 0;
		try {
			await act(async () => root.render(<RestartDialog name="Ada" open onLater={() => {}} onRestart={() => restarted++} />));
			assert.equal(document.querySelector('[data-testid="restart-dialog"] p')?.textContent, "Ada is answering you. Restarting stops Ada.");
			await click("restart-now");
			assert.ok(restarted === 1);
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});
});

describe("the chat in a window of its own", () => {
	const ON = access();

	it("shows Pop out only where the shell has the window", async () => {
		const shell = fakeShell([teacher()]);
		try {
			await mounted(ON, async () => {
				await click("open-chat");
				assert.equal(q("teacher-panel-pop-out"), null, "an older shell: no window to make");
			});
		} finally {
			shell.remove();
		}
		const withWindow = fakeShell([teacher()], true);
		try {
			await mounted(ON, async () => {
				await click("open-chat");
				assert.equal(text("teacher-panel-pop-out"), "Pop out");
				await click("teacher-panel-pop-out");
				assert.ok(withWindow.calls.includes("window open Ada"), "titled with the teacher's name");
			});
		} finally {
			withWindow.remove();
		}
	});

	it("while it is open the column shows Activity with Follow and Put back, and no chat", async () => {
		const shell = fakeShell([teacher()], true);
		try {
			await mounted(ON, async () => {
				await click("open-chat");
				assert.ok(q("talk-chat") !== null);
				await act(async () => shell.windowOpen(true));
				await settle();
				assert.ok(q("teacher-panel") === null, "the column closes: the page gets its room back");
				await click("open-panel");
				assert.ok(q("talk-chat") === null && q("teacher-panel-pop-out") === null, "the chat left the column");
				assert.ok(q("activity-list") !== null, "Activity is the body");
				assert.ok(q("follow-start") !== null || q("follow-stop") !== null, "Follow stays");
				assert.equal(text("teacher-panel-put-back"), "Put back");
				assert.ok(q("teacher-panel-activity") === null && q("teacher-panel-chats") === null, "no Activity or Chats key: Activity is the body");
				await click("teacher-panel-put-back");
				assert.ok(shell.calls.includes("window close"));
				assert.ok(q("talk-chat") === null, "the shell's report brings it back, not the key");
				await act(async () => shell.windowOpen(false, true));
				await settle();
				assert.ok(q("talk-chat") !== null, "the chat shows in the column again");
			});
		} finally {
			shell.remove();
		}
	});

	it("put back from the chat's window opens the column on the chat", async () => {
		const shell = fakeShell([teacher()], true);
		try {
			await mounted(ON, async () => {
				await act(async () => shell.windowOpen(true));
				assert.ok(q("teacher-panel") === null);
				await act(async () => shell.windowOpen(false, true));
				await settle();
				assert.ok(q("talk-chat") !== null);
			});
		} finally {
			shell.remove();
		}
	});

	it("closing the window by its own button leaves a shut column shut", async () => {
		const shell = fakeShell([teacher()], true);
		try {
			await mounted(ON, async () => {
				await act(async () => shell.windowOpen(true));
				await act(async () => shell.windowOpen(false));
				await settle();
				assert.ok(q("teacher-panel") === null);
			});
		} finally {
			shell.remove();
		}
	});

	it("a card brings no panel while it is open; the status line's click and every key that shows the chat bring the window forward", async () => {
		const shell = fakeShell([teacher({ prompt: "trust" })], true);
		const focuses = () => shell.calls.filter((c) => c === "window focus").length;
		try {
			await mounted(ON, async () => {
				await act(async () => shell.windowOpen(true));
				await click("need-on");
				assert.ok(q("teacher-panel") === null, "the panel stays shut");
				await click("status");
				assert.equal(focuses(), 1);
				assert.ok(q("teacher-panel") === null, "and opens no column");
				await click("open-panel");
				await click("open-chat");
				assert.equal(focuses(), 2, "even with the column open");
				assert.ok(q("talk-chat") === null);
				await act(async () => shell.windowOpen(false));
				await settle();
				await click("close-panel");
				await act(() => new Promise((r) => setTimeout(r, 150)));
				assert.ok(q("teacher-panel") === null, "a card that came meanwhile does not open it on the way back");
			});
		} finally {
			shell.remove();
		}
	});

	it("is a page with the head's name, Put back and the chat, and no other panel key", async () => {
		const shell = fakeShell([teacher()], true);
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		try {
			await act(async () =>
				root.render(
					<MemoryRouter>
						<ServerEventsProvider connect={noEvents as never}>
							<TerminalsProvider status={ON} inTerminalWindow>
								<ChatWindow />
							</TerminalsProvider>
						</ServerEventsProvider>
					</MemoryRouter>,
				),
			);
			await settle();
			assert.ok(q("chat-window") !== null && q("teacher-panel-agent") !== null);
			assert.ok(q("talk-chat") !== null, "the chat, at its end");
			for (const gone of ["teacher-panel-pop-out", "teacher-panel-activity", "teacher-panel-chats", "follow-start", "follow-stop"]) assert.equal(q(gone), null, gone);
			await click("teacher-panel-put-back");
			assert.deepEqual(shell.calls.filter((c) => c.startsWith("window")), ["window close"], "it only closes: the column is the main window's");
		} finally {
			await act(async () => root.unmount());
			await settle();
			host.remove();
			shell.remove();
		}
	});
});
