/**
 * Starting the agent from the teacher's panel: the web version keeps the
 * copy-command path, the desktop app starts the teacher's terminal, and a
 * lesson's send starts no terminal: lessons run on the picked agent in
 * sessions of their own.
 */
import { dom, fakeShell } from "../terminal-dom.ts";
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

const { StartTeacher } = await import("../../src/frontend/components/teacher/start-teacher.tsx");
const { TerminalsProvider, useTerminals } = await import("../../src/frontend/components/terminal/use-terminals.ts");
const { useAgentStatus } = await import("../../src/frontend/components/agent-status.tsx");
const { agentDoing } = await import("../../src/frontend/components/teacher/follow-status.ts");
const { agentLine } = await import("../../src/frontend/components/teacher/teacher-panel.tsx");
const { stripView } = await import("../../src/frontend/components/strip/strip-model.ts");
const { teacherTile } = await import("../../src/frontend/components/settings/agent-windows-model.ts");
const { teacherTerminalState } = await import("../../src/frontend/components/terminal/terminal-model.ts");
const { useChatSession } = await import("../../src/frontend/components/session.ts");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { AgentFolderProvider } = await import("../../src/frontend/components/agent-folder/agent-folder-context.tsx");
type Access = Parameters<typeof TerminalsProvider>[0]["status"];
type Api = NonNullable<ReturnType<typeof useTerminals>>;

const FOLDER = {
	folder: "/home/ada/godspeed",
	short: "~/godspeed",
	exists: true,
	commands: { claude: "claude", codex: "codex" },
	startCommands: {},
	oldSetup: { plugin: false, codex: false },
	agent: "claude",
};
const access = (over: Partial<NonNullable<Access>> = {}): Access => ({ connected: false, turnsRunning: 0, terminals: [], outsideHere: false, ...over });

const stored = new Map<string, string>();
const realFetch = globalThis.fetch;
/** The agent the server keeps for the next test's folder; null before a pick. */
let serverAgent: string | null = "claude";
/** What the page asked the server to change. */
const changes: string[] = [];
beforeEach(() => {
	stored.clear();
	changes.length = 0;
	serverAgent = "claude";
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v), removeItem: (k: string) => void stored.delete(k) },
	});
	globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
		if (init?.method) changes.push(`${init.method} ${String(init.body)}`);
		if (init?.method === "PATCH") serverAgent = (JSON.parse(String(init.body)) as { agent: string }).agent;
		return Response.json({ ...FOLDER, agent: serverAgent });
	}) as unknown as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));
const q = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);

type Root = ReturnType<typeof createRoot>;
const noEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });

/** Renders under the server's events and the folder's one read, as the app does. */
async function mounted(render: (root: Root) => Promise<void>, run: () => Promise<void>) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const inEvents = { render: (node: React.ReactNode) => root.render(
				<ServerEventsProvider connect={noEvents as never}>
					<AgentFolderProvider>{node}</AgentFolderProvider>
				</ServerEventsProvider>,
			), unmount: () => root.unmount() } as Root;
	try {
		await render(inEvents);
		await settle();
		await run();
	} finally {
		await act(async () => root.unmount());
		await settle();
		host.remove();
	}
}

describe("Start Claude Code", () => {
	it("in the web version, makes the folder and asks the learner to run the command, as before", async () => {
		serverAgent = null;
		assert.ok(!(dom.window as { lh?: unknown }).lh, "no desktop shell");
		await mounted(
			(root) => act(async () => root.render(<StartTeacher />)),
			async () => {
				assert.equal(q("open-agent")!.textContent, "Start Claude Code");
				await act(async () => q("open-agent")!.click());
				await settle();
				assert.match(document.body.textContent!, /Run the command from Settings, Connection in your terminal\./);
				assert.ok(changes.some((c) => c.startsWith("POST") && c.includes('"setup"')), "the folder was made");
				assert.ok(changes.includes('PATCH {"agent":"claude"}'), "the agent it started is the learner's pick from now on");
			},
		);
	});

	it("in the desktop app, starts the teacher's terminal", async () => {
		const shell = fakeShell();
		try {
			await mounted(
				(r) =>
					act(async () =>
						r.render(
							<TerminalsProvider status={access()}>
								<StartTeacher />
							</TerminalsProvider>,
						),
					),
				async () => {
					assert.ok(q("open-agent")!.classList.contains("lh-btn-main"), "Start Claude Code leads");
					assert.ok(!q("open-agent-menu")!.classList.contains("lh-btn-main"));
					await act(async () => q("open-agent")!.click());
					await settle();
					assert.ok(shell.calls.includes("start claude"), shell.calls.join(", "));
				},
			);
		} finally {
			shell.remove();
		}
	});
});

describe("Start with an agent outside godspeed connected", () => {
	it("still sets up the folder, starts nothing and says why", async () => {
		const shell = fakeShell();
		const posts: string[] = [];
		globalThis.fetch = (async (_url: string, init?: RequestInit) => {
			if (init?.method === "POST") posts.push(String(init.body));
			return Response.json(FOLDER);
		}) as unknown as typeof fetch;
		try {
			await mounted(
				(r) =>
					act(async () =>
						r.render(
							<TerminalsProvider status={access({ connected: true, outsideHere: true })}>
								<StartTeacher />
							</TerminalsProvider>,
						),
					),
				async () => {
					await act(async () => q("open-agent")!.click());
					await settle();
					assert.ok(posts.some((b) => b.includes('"setup"')), "the folder was set up");
					assert.ok(!shell.calls.some((c) => c.startsWith("start")), "no second teacher");
					assert.match(document.body.textContent!, /The teacher is already running outside godspeed\. Close it there first\./);
				},
			);
		} finally {
			shell.remove();
		}
	});
});

describe("the shell's list", () => {
	it("an answer that comes late never replaces a newer teacher", async () => {
		const old = { id: "t0", agent: "claude" as const, startedAt: Date.now() - 60_000, ended: { stopped: false as const, code: 1 }, prompt: null, url: false };
		const shell = fakeShell([old]);
		let api: Api | null = null;
		function Probe() {
			api = useTerminals();
			return null;
		}
		try {
			await mounted(
				(r) =>
					act(async () =>
						r.render(
							<TerminalsProvider status={access()}>
								<Probe />
							</TerminalsProvider>,
						),
					),
				async () => {
					assert.equal(api!.teacher?.id, "t0");
					await act(async () => void (await api!.start("claude")));
					assert.equal(api!.teacher?.id, "teacher-new");
					// A push for a terminal the page doesn't know asks for the list again; it still holds t0.
					await act(async () => shell.push({ id: "helper-x", ended: null, prompt: null, url: false }));
					await settle();
					assert.equal(api!.teacher?.id, "teacher-new", "the old crashed teacher did not come back");
				},
			);
		} finally {
			shell.remove();
		}
	});
});

describe("a lesson's send", () => {
	it("starts no terminal, whatever the terminal did before", async () => {
		const ended = (code: number | null) => ({ id: "t0", agent: "claude" as const, startedAt: Date.now() - 60_000, ended: { stopped: false as const, code }, prompt: null, url: false });
		// The session tells the page a turn runs with the page's own event type.
		const realEvent = globalThis.CustomEvent;
		globalThis.CustomEvent = (dom.window as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent;
		for (const shell of [fakeShell([ended(0)]), fakeShell()]) {
			globalThis.fetch = (async (input: RequestInfo | URL) => {
				const url = String(input);
				if (url === "/api/chat") return Response.json({ ok: true });
				if (url === "/api/chats/c1") return Response.json({ messages: [] });
				if (url === "/api/chats/c1/stream") {
					const body = new ReadableStream({ start: (c) => void setTimeout(() => (c.enqueue(new TextEncoder().encode("data: [DONE]\n\n")), c.close()), 300) });
					return new Response(body);
				}
				return Response.json(FOLDER);
			}) as unknown as typeof fetch;
			let session: ReturnType<typeof useChatSession> | null = null;
			function Lesson() {
				session = useChatSession({ chatId: "c1", initialMessages: [] });
				return null;
			}
			try {
				await mounted(
					(r) =>
						act(async () =>
							r.render(
								<TerminalsProvider status={access({ })}>
									<Lesson />
								</TerminalsProvider>,
							),
						),
					async () => {
						await act(async () => {
							void session!.send({ type: "text", text: "why is the slope negative?" });
							void session!.send({ type: "side", text: "and the intercept?" });
						});
						await settle();
						assert.ok(!shell.calls.some((c) => c.startsWith("start")), shell.calls.join(", "));
						await act(() => new Promise((r) => setTimeout(r, 400)));
					},
				);
			} finally {
				shell.remove();
			}
		}
		globalThis.CustomEvent = realEvent;
	});
});

describe("after godspeed's teacher ended, though the server still says connected for 3 minutes", () => {
	const teacherRec = { id: "t1", agent: "claude" as const, startedAt: Date.now() - 60_000, ended: null, prompt: null, url: false };

	it("only `connected` drops at once: the agent still teaches on the strip, the panel's line and Settings", async () => {
		const shell = fakeShell([teacherRec]);
		let api: Api | null = null;
		let seen: Access = null;
		const status = () => seen;
		function Probe() {
			api = useTerminals();
			seen = useAgentStatus();
			return null;
		}
		const page = (s: Access) => (
			<TerminalsProvider status={s}>
				<Probe />
			</TerminalsProvider>
		);
		// What each surface shows, from the status every surface reads.
		const words = () => {
			const agent = status()!;
			const doing = agentDoing({ agent, round: null, lesson: { working: true }, extractions: [], jobs: [] });
			const facts = api!.facts;
			return {
				strip: stripView({ agent, terminal: teacherTerminalState(facts), working: !!doing?.working, work: null, ready: [], asking: [], panelOpen: false }).square,
				panel: agentLine(agent, "Teacher", doing),
				tile: teacherTile(doing, false).chip,
			};
		};
		const busy = { connected: true, name: "Claude Code", turnsRunning: 1 };
		let root: Root | null = null;
		try {
			await mounted(
				async (r) => {
					root = r;
					await act(async () => r.render(page(access({ ...busy, terminals: [{ id: "t1", here: true }] }))));
				},
				async () => {
					assert.deepEqual(words(), { strip: "working", panel: "Working", tile: "Teaching" });
					await act(async () => shell.push({ id: "t1", ended: { stopped: true, code: null }, prompt: null, url: false }));
					await act(async () => root!.render(page(access(busy))));
					assert.deepEqual(words(), { strip: "working", panel: "Working", tile: "Teaching" });
					assert.equal(status()!.connected, false, "the terminals know it ended");
				},
			);
		} finally {
			shell.remove();
		}
	});
});

describe("the records", () => {
	/** A shell whose list and start answer when the test says. */
	function slowShell() {
		const shell = fakeShell();
		const lists: Array<(l: unknown[]) => void> = [];
		let started: ((v: { id: string }) => void) | null = null;
		const t = (dom.window as unknown as { lh: { terminals: Record<string, unknown> } }).lh.terminals;
		t.list = () => new Promise((r) => lists.push(r));
		t.start = (agent: string) => (shell.calls.push(`start ${agent}`), new Promise((r) => (started = r)));
		return { shell, lists, start: (id: string) => started!({ id }) };
	}
	const gone = { id: "teacher-new", agent: "claude" as const, startedAt: Date.now(), ended: { stopped: false as const, code: 3 }, prompt: null, url: false };

	for (const order of ["the start answers first", "the list answers first"] as const) {
		it(`an end always wins over a live record of the same terminal: ${order}`, async () => {
			const { shell, lists, start } = slowShell();
			let api: Api | null = null;
			function Probe() {
				api = useTerminals();
				return null;
			}
			try {
				await mounted(
					(r) =>
						act(async () =>
							r.render(
								<TerminalsProvider status={access()}>
									<Probe />
								</TerminalsProvider>,
							),
						),
					async () => {
						await act(async () => lists.shift()!([]));
						let why: Promise<string | null> | null = null;
						await act(async () => void (why = api!.start("claude")));
						await settle();
						// It ends at once (not installed): the push comes before the start's answer.
						await act(async () => shell.push({ id: "teacher-new", ended: gone.ended, prompt: null, url: false }));
						if (order === "the start answers first") {
							await act(async () => start("teacher-new"));
							await act(async () => lists.shift()!([gone]));
						} else {
							await act(async () => lists.shift()!([gone]));
							await act(async () => start("teacher-new"));
						}
						await act(async () => void (await why));
						await settle();
						assert.ok(api!.teacher?.id === "teacher-new" && api!.teacher.ended?.code === 3, JSON.stringify(api!.teacher));
					},
				);
			} finally {
				shell.remove();
			}
		});
	}
});
