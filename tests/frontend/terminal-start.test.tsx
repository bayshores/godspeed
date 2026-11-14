/**
 * Starting the agent: the web version keeps the copy-command path, the
 * desktop app starts the teacher's terminal and shows its screen in
 * onboarding's step, and Start lesson or a Talk send start the agent last
 * started here, hidden.
 */
import { dom, fakeShell } from "../terminal-dom.ts";
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

const { AgentLauncher } = await import("../../src/frontend/components/agent-folder/agent-launcher.tsx");
const { TerminalsProvider, useTerminals } = await import("../../src/frontend/components/terminal/use-terminals.ts");
type Access = Parameters<typeof TerminalsProvider>[0]["status"];
type Api = NonNullable<ReturnType<typeof useTerminals>>;

const FOLDER = {
	folder: "/home/ada/godspeed",
	short: "~/godspeed",
	exists: true,
	commands: { claude: "claude", codex: "codex" },
	startCommands: {},
	oldSetup: { plugin: false, codex: false },
};
const access = (over: Partial<NonNullable<Access>> = {}): Access => ({ connected: false, teaching: false, helperHere: false, helperCovering: false, pendingWork: 0, pendingTurns: 0, claimedLessons: [], terminals: [], outsideHere: false, ...over });

const stored = new Map<string, string>();
const realFetch = globalThis.fetch;
beforeEach(() => {
	stored.clear();
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v), removeItem: (k: string) => void stored.delete(k) },
	});
	globalThis.fetch = (async () => Response.json(FOLDER)) as unknown as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));
const q = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);

async function mounted(render: (root: ReturnType<typeof createRoot>) => Promise<void>, run: () => Promise<void>) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	try {
		await render(root);
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
		assert.ok(!(dom.window as { lh?: unknown }).lh, "no desktop shell");
		await mounted(
			(root) => act(async () => root.render(<AgentLauncher />)),
			async () => {
				assert.equal(q("open-agent")!.textContent, "Start Claude Code");
				await act(async () => q("open-agent")!.click());
				await settle();
				const log = q("agent-launch-log")?.textContent ?? "";
				assert.match(log, /Made ~\/godspeed/);
				assert.match(log, /Copy the command and run it in your terminal/);
				assert.ok(q("first-run-screen") === null, "no screen in a browser");
				assert.equal(stored.get("lh-folder-agent"), "claude");
			},
		);
	});

	it("in the desktop app, starts the teacher's terminal and shows its screen in the step until it connects", async () => {
		const shell = fakeShell();
		const page = (status: Access) => (
			<TerminalsProvider status={status}>
				<AgentLauncher />
			</TerminalsProvider>
		);
		let root: ReturnType<typeof createRoot> | null = null;
		try {
			await mounted(
				async (r) => {
					root = r;
					await act(async () => r.render(page(access())));
				},
				async () => {
					assert.ok(q("open-agent")!.classList.contains("lh-btn-main"), "Start Claude Code leads before any start");
					assert.ok(!q("open-agent-menu")!.classList.contains("lh-btn-main"));
					await act(async () => q("open-agent")!.click());
					await settle();
					assert.ok(shell.calls.includes("start teacher claude"), shell.calls.join(", "));
					assert.ok(q("open-agent") === null && q("open-agent-menu") === null, "no start buttons while the agent runs");
					assert.ok(q("agent-launch-log") === null, "no copy-command log");
					assert.ok(q("first-run-screen") !== null, "the screen shows in the step");
					assert.equal(q("terminal-footer")!.textContent, "Claude Code is starting in ~/godspeed. If it asks you something, answer it here.");
					await act(async () => root!.render(page(access({ connected: true, terminals: [{ id: "teacher-new", here: true }] }))));
					await settle();
					assert.equal(q("terminal-footer")!.textContent, "Claude Code is connected.");
					await act(async () => shell.push({ id: "teacher-new", ended: { stopped: true, code: null }, prompt: null, url: false }));
					await act(async () => root!.render(page(access())));
					await settle();
					assert.ok(q("open-agent") !== null, "the start buttons return once it ended");
					assert.ok(!q("open-agent")!.classList.contains("lh-btn-main"), "Start again in the footer leads then");
				},
			);
		} finally {
			shell.remove();
		}
	});
});

describe("Start lesson and a Talk send", () => {
	it("start the agent last started here, hidden, only when no agent is here", async () => {
		const shell = fakeShell();
		let api: Api | null = null;
		function Probe() {
			api = useTerminals();
			return null;
		}
		const page = (status: Access) => (
			<TerminalsProvider status={status}>
				<Probe />
			</TerminalsProvider>
		);
		let root: ReturnType<typeof createRoot> | null = null;
		try {
			await mounted(
				async (r) => {
					root = r;
					await act(async () => r.render(page(access({ connected: true }))));
				},
				async () => {
					stored.set("lh-folder-agent", "codex");
					await act(async () => api!.wake());
					assert.ok(!shell.calls.some((c) => c.startsWith("start")), "an agent is here");
					await act(async () => root!.render(page(access())));
					await act(async () => api!.wake());
					await settle();
					assert.ok(shell.calls.includes("start teacher codex"), shell.calls.join(", "));
					assert.ok(api!.overlay === null, "it starts hidden");
				},
			);
		} finally {
			shell.remove();
		}
	});

	it("leave it to the no-agent line when no agent was ever started here", async () => {
		const shell = fakeShell();
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
					await act(async () => api!.wake());
					await settle();
					assert.ok(!shell.calls.some((c) => c.startsWith("start")), shell.calls.join(", "));
				},
			);
		} finally {
			shell.remove();
		}
	});
});
