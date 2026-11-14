/**
 * The terminal overlay and the teacher's status line: what opens the
 * screen by itself, its one bright key, what closes it, and the web
 * version, which has no terminals and keeps its plain status line.
 */
import { dom, fakeShell, press } from "../terminal-dom.ts";
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { createRoot } from "react-dom/client";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { TerminalRecord } from "../../src/frontend/components/terminal/terminal-model.ts";

const { TerminalsProvider } = await import("../../src/frontend/components/terminal/use-terminals.ts");
const { TerminalOverlay } = await import("../../src/frontend/components/terminal/terminal-overlay.tsx");
const { TeacherStatus } = await import("../../src/frontend/components/terminal/teacher-status.tsx");
const { RestartDialog } = await import("../../src/frontend/components/terminal/restart-dialog.tsx");
type Access = Parameters<typeof TerminalsProvider>[0]["status"];

const access = (over: Partial<NonNullable<Access>> = {}): Access => ({ connected: false, teaching: false, helperHere: false, helperCovering: false, pendingWork: 0, pendingTurns: 0, claimedLessons: [], terminals: [], outsideHere: false, ...over });
const teacher = (over: Partial<TerminalRecord> = {}): TerminalRecord => ({ id: "t1", role: "teacher", agent: "claude", startedAt: Date.now(), ended: null, prompt: null, url: false, ...over });

function Page({ status }: { status: Access }) {
	return (
		<TerminalsProvider status={status}>
			<TeacherStatus name="Ada" line="Teaching, idle" testid="status" />
			<TerminalOverlay name="Ada" />
		</TerminalsProvider>
	);
}

const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));
/** The open overlay; one that is fading out counts as closed. */
const overlay = () => document.querySelector('[data-testid="terminal-overlay"][data-state="open"]');
const text = (testid: string) => document.querySelector(`[data-testid="${testid}"]`)?.textContent ?? null;
const click = async (testid: string) => {
	const el = document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
	assert.ok(el !== null, `${testid} shows`);
	await act(async () => el.click());
	await settle();
};

async function mounted(status: Access, run: (render: (s: Access) => Promise<void>) => Promise<void>) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const render = async (s: Access) => {
		await act(async () => root.render(<Page status={s} />));
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
	it("has no terminals: the status line is plain text and no screen opens", async () => {
		delete (dom.window as { lh?: unknown }).lh;
		await mounted(access({ teaching: true }), async () => {
			const status = document.querySelector('[data-testid="status"]');
			assert.ok(status?.tagName === "SPAN", "plain text, not a button");
			assert.equal(status?.textContent, "Teaching, idle");
			assert.ok(overlay() === null);
		});
	});
});

describe("the overlay", () => {
	it("opens by itself on the trust question, with its one bright key", async () => {
		const shell = fakeShell([teacher({ prompt: "trust" })]);
		try {
			await mounted(access(), async () => {
				assert.ok(overlay() !== null, "it opened");
				assert.equal(text("terminal-footer"), "Claude Code asks whether it may work in ~/godspeed. godspeed made this folder for it.");
				const bright = [...document.querySelectorAll('[data-testid="terminal-overlay"] .lh-btn-main')];
				assert.ok(bright.length === 1 && bright[0]!.textContent === "Yes, trust this folder", "one bright key");
				assert.equal(text("status"), "Ada needs you.");
				await click("terminal-assist");
				assert.ok(shell.calls.includes("answer trust"));
			});
		} finally {
			shell.remove();
		}
	});

	it("Escape does not close it; Hide does, and the same question does not reopen it", async () => {
		const shell = fakeShell([teacher({ prompt: "menu" })]);
		try {
			await mounted(access(), async (render) => {
				assert.ok(overlay() !== null);
				press(document.body, "Escape", 27);
				await settle();
				assert.ok(overlay() !== null, "Escape belongs to the agent");
				await click("terminal-hide");
				assert.ok(overlay() === null, "Hide closed it");
				await render(access());
				assert.ok(overlay() === null, "not reopened for the same question");
				await click("status");
				assert.ok(overlay() !== null, "the status line shows it again");
			});
		} finally {
			shell.remove();
		}
	});

	it("a crash opens it with Start again as the bright key", async () => {
		const shell = fakeShell([teacher()]);
		try {
			await mounted(access({ terminals: [{ id: "t1", here: true }] }), async () => {
				assert.ok(overlay() === null, "running quietly");
				await act(async () => shell.push({ id: "t1", ended: { stopped: false, code: 1 }, prompt: null, url: false }));
				await settle();
				assert.ok(overlay() !== null, "it opened");
				assert.equal(text("terminal-footer"), "Claude Code closed with an error. The last lines are above.");
				assert.ok(document.querySelector('[data-testid="terminal-stop"]') === null, "nothing to stop");
				const bright = [...document.querySelectorAll('[data-testid="terminal-overlay"] .lh-btn-main')];
				assert.ok(bright.length === 1 && bright[0]!.textContent === "Start again");
				await click("terminal-start-again");
				assert.ok(shell.calls.includes("start teacher claude"));
			});
		} finally {
			shell.remove();
		}
	});

	it("a running teacher: no bright key, Stop is there, and a helper gets its own tab", async () => {
		const shell = fakeShell([teacher(), teacher({ id: "h1", role: "helper" })]);
		try {
			await mounted(access({ teaching: true, terminals: [{ id: "t1", here: true }, { id: "h1", here: true }] }), async () => {
				assert.equal(text("status"), "Teaching, idle");
				await click("status");
				assert.equal(text("terminal-footer"), "Ada is running in ~/godspeed.");
				assert.ok(document.querySelectorAll('[data-testid="terminal-overlay"] .lh-btn-main').length === 0, "nothing bright");
				await click("terminal-tab-helper");
				assert.equal(text("terminal-footer"), "The helper is waiting for files to read.");
				await click("terminal-stop");
				assert.ok(shell.calls.includes("stop h1"));
			});
		} finally {
			shell.remove();
		}
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
			assert.equal(document.querySelector('[data-testid="restart-dialog"] p')?.textContent, "Ada is answering you. Restarting stops Ada. Start it again after godspeed opens.");
			await click("restart-now");
			assert.ok(restarted === 1);
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});
});
