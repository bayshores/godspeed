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
const { FirstRunScreen } = await import("../../src/frontend/components/terminal/first-run-screen.tsx");
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

	it("opens by itself when the teacher has not checked in 20 s after its start, while the page is open", async () => {
		const shell = fakeShell([teacher({ startedAt: Date.now() - 19_700, url: true })]);
		try {
			await mounted(access(), async () => {
				assert.ok(overlay() === null, "still starting");
				await act(() => new Promise((r) => setTimeout(r, 500)));
				await settle();
				assert.ok(overlay() !== null, "it opened");
				assert.equal(text("status"), "Ada needs you.");
			});
		} finally {
			shell.remove();
		}
	});

	it("when the window comes back after the system held its timers, a 20 s that passed meanwhile opens it at once", async () => {
		const shell = fakeShell([teacher({ startedAt: Date.now() - 10_000, url: true })]);
		const realNow = Date.now;
		try {
			await mounted(access(), async () => {
				assert.ok(overlay() === null, "still starting");
				// 15 s pass with no timer firing, as in a background window.
				Date.now = () => realNow() + 15_000;
				await act(async () => void dom.window.dispatchEvent(new dom.window.Event("focus")));
				await settle();
				assert.ok(overlay() !== null, "it opened");
			});
		} finally {
			Date.now = realNow;
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

describe("the keyboard and the overlay", () => {
	it("opening by itself takes no keys: the box the learner types in keeps them until a click in the screen", async () => {
		const shell = fakeShell([teacher()]);
		const box = document.createElement("textarea");
		document.body.append(box);
		const screen = () => document.querySelector<HTMLElement>("[data-terminal-screen] textarea");
		const wrote = () => shell.calls.some((c) => c.startsWith("write "));
		// This DOM keeps no focus: follow it through focus().
		const proto = dom.window.HTMLElement.prototype as { focus: () => void };
		const realFocus = proto.focus;
		let focused: unknown = null;
		proto.focus = function (this: unknown) {
			focused = this;
		};
		try {
			await mounted(access({ teaching: true, terminals: [{ id: "t1", here: true }] }), async () => {
				box.focus();
				assert.ok(focused === box, "the learner types in the box");
				await act(async () => shell.push({ id: "t1", ended: null, prompt: "menu", url: false }));
				for (let i = 0; i < 10 && !screen(); i++) await settle();
				assert.ok(overlay() !== null, "a permission menu opened it");
				assert.ok(screen() !== null, "the screen drew");
				assert.ok(focused === box, "the box kept the keyboard");
				press(box, "1", 49);
				press(box, "Enter", 13);
				assert.ok(!wrote(), "no key reached the agent");
				await click("terminal-hide");
				await click("status");
				for (let i = 0; i < 10 && !screen(); i++) await settle();
				assert.ok(focused === screen(), "opened by the learner, the screen takes the keyboard");
			});
		} finally {
			proto.focus = realFocus;
			box.remove();
			shell.remove();
		}
	});
});

describe("onboarding", () => {
	it("the step's own screen takes no keys and stands in for the overlay; past the step, a question opens the overlay", async () => {
		const shell = fakeShell([teacher({ prompt: "menu" }), teacher({ id: "h1", role: "helper" })]);
		const proto = dom.window.HTMLElement.prototype as { focus: () => void };
		const realFocus = proto.focus;
		let focused = 0;
		proto.focus = () => void focused++;
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		const page = (step: boolean) => (
			<TerminalsProvider status={access({ terminals: [{ id: "t1", here: true }, { id: "h1", here: true }] })}>
				{step && <FirstRunScreen />}
				<TerminalOverlay name="Ada" />
			</TerminalsProvider>
		);
		try {
			await act(async () => root.render(page(true)));
			for (let i = 0; i < 10 && !document.querySelector("[data-terminal-screen] textarea"); i++) await settle();
			assert.ok(document.querySelector('[data-testid="first-run-screen"]') !== null);
			assert.ok(overlay() === null, "no second view of the same screen");
			assert.ok(focused === 0, "no focus until a click");
			await act(async () => root.render(page(false)));
			await settle();
			assert.ok(overlay() === null, "the question was seen in the step");
			await act(async () => shell.push({ id: "h1", ended: null, prompt: "menu", url: false }));
			await settle();
			assert.ok(overlay() !== null, "the helper's question shows over the next step");
		} finally {
			proto.focus = realFocus;
			await act(async () => root.unmount());
			await settle();
			host.remove();
			shell.remove();
		}
	});
});

describe("the footer", () => {
	it("a refused Paste shows until the footer has something new to say", async () => {
		const shell = fakeShell([teacher()]);
		const terminals = (dom.window as unknown as { lh: { terminals: { paste: () => Promise<void> } } }).lh.terminals;
		terminals.paste = () => Promise.reject("Show the terminal and click in it first.");
		try {
			await mounted(access({ teaching: true, terminals: [{ id: "t1", here: true }] }), async () => {
				await click("status");
				await click("terminal-paste");
				assert.equal(text("terminal-footer"), "Show the terminal and click in it first.");
				await act(async () => shell.push({ id: "t1", ended: null, prompt: "trust", url: false }));
				await settle();
				assert.equal(text("terminal-footer"), "Claude Code asks whether it may work in ~/godspeed. godspeed made this folder for it.");
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
