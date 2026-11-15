/**
 * The teacher panel's Terminal tab and the teacher's status line: what
 * opens it by itself, the mark while another tab shows, its one bright
 * key, the Start buttons that open it, and the web version, which has no
 * terminals and keeps its plain status line.
 */
import { dom, fakeShell, press } from "../terminal-dom.ts";
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { TerminalRecord } from "../../src/frontend/components/terminal/terminal-model.ts";
import type { TeacherApi } from "../../src/frontend/components/teacher/teacher-context.ts";

const { TerminalsProvider, useTerminals } = await import("../../src/frontend/components/terminal/use-terminals.ts");
const { TeacherStatus } = await import("../../src/frontend/components/terminal/teacher-status.tsx");
const { RestartDialog } = await import("../../src/frontend/components/terminal/restart-dialog.tsx");
const { FirstRunScreen } = await import("../../src/frontend/components/terminal/first-run-screen.tsx");
const { AgentNeed } = await import("../../src/frontend/components/onboarding/agent-need.tsx");
const { TeacherPanel } = await import("../../src/frontend/components/teacher/teacher-panel.tsx");
const { TeacherContext } = await import("../../src/frontend/components/teacher/teacher-context.ts");
const { useTeacherPanel } = await import("../../src/frontend/components/teacher/use-teacher-panel.ts");
const { NoAgentLine } = await import("../../src/frontend/components/agent-folder/no-agent-line.tsx");
type Access = Parameters<typeof TerminalsProvider>[0]["status"];

const access = (over: Partial<NonNullable<Access>> = {}): Access => ({ connected: false, teaching: false, helperHere: false, helperCovering: false, pendingWork: 0, pendingTurns: 0, claimedLessons: [], terminals: [], outsideHere: false, ...over });
const teacher = (over: Partial<TerminalRecord> = {}): TerminalRecord => ({ id: "t1", role: "teacher", agent: "claude", startedAt: Date.now(), ended: null, prompt: null, url: false, ...over });
const FOLDER = { folder: "/home/ada/godspeed", short: "~/godspeed", exists: true, commands: { claude: "claude", codex: "codex" }, startCommands: {}, oldSetup: { plugin: false, codex: false } };

const realFetch = globalThis.fetch;
const stored = new Map<string, string>();
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

/** The teacher's panel as the provider holds it, with Activity as the
 *  other tab (Talk needs the whole window to mount). */
function PanelHost({ children }: { children?: React.ReactNode }) {
	const panel = useTeacherPanel();
	const tabs = useTerminals()?.available ? (["activity", "terminal"] as const) : (["activity"] as const);
	const api: TeacherApi = {
		name: "Ada",
		follow: false,
		setFollow: () => {},
		panelOpen: panel.open,
		panelStarts: false,
		setPanelOpen: panel.setOpen,
		showActivity: panel.showActivity,
		showTerminal: panel.showTerminal,
		recent: [],
		doing: null,
		setLesson: () => {},
		go: () => {},
		offer: null,
		spaceNameOf: () => null,
	};
	return (
		<TeacherContext.Provider value={api}>
			<TeacherStatus name="Ada" line="Teaching, idle" testid="status" />
			<button type="button" data-testid="open-activity" onClick={panel.showActivity} />
			{children}
			{panel.open && (tabs as readonly string[]).includes(panel.tab) && (
				<TeacherPanel
					name="Ada"
					agent={null}
					tabs={tabs}
					overLesson={false}
					tab={panel.tab}
					onTab={panel.setTab}
					screen={panel.role}
					onScreen={panel.setRole}
					focus={panel.focus}
					onClose={() => panel.setOpen(false)}
					recent={[]}
					onPick={() => {}}
				/>
			)}
		</TeacherContext.Provider>
	);
}

const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));
const q = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const text = (testid: string) => q(testid)?.textContent ?? null;
const selected = (tab: string) => q(`teacher-tab-${tab}`)?.getAttribute("aria-selected") === "true";
/** The panel open on its Terminal tab. */
const onTerminal = () => q("teacher-panel") !== null && selected("terminal");
const bright = () => [...document.querySelectorAll('[data-testid="teacher-panel"] .lh-btn-main')].map((b) => b.textContent);
const click = async (testid: string) => {
	const el = q(testid);
	assert.ok(el !== null, `${testid} shows`);
	await act(async () => el.click());
	await settle();
};

async function mounted(status: Access, run: (render: (s: Access, extra?: React.ReactNode) => Promise<void>) => Promise<void>, extra?: React.ReactNode) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const render = async (s: Access, more: React.ReactNode = extra) => {
		await act(async () =>
			root.render(
				<TerminalsProvider status={s}>
					<PanelHost>{more}</PanelHost>
				</TerminalsProvider>,
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
	it("has no terminals: the status line is plain text and no Terminal tab", async () => {
		delete (dom.window as { lh?: unknown }).lh;
		await mounted(access({ teaching: true }), async () => {
			const status = q("status");
			assert.ok(status?.tagName === "SPAN", "plain text, not a button");
			assert.equal(status?.textContent, "Teaching, idle");
			await click("open-activity");
			assert.ok(q("teacher-panel") !== null && q("teacher-tab-terminal") === null);
		});
	});
});

describe("opening by itself", () => {
	it("a closed panel opens on Terminal at the trust question, with its one bright key", async () => {
		const shell = fakeShell([teacher({ prompt: "trust" })]);
		try {
			await mounted(access(), async () => {
				assert.ok(onTerminal(), "it opened on Terminal");
				assert.equal(text("status"), "Claude Code asks to trust its folder.");
				assert.equal(text("terminal-footer"), "godspeed made the folder for it.", "the status line already asks");
				assert.deepEqual(bright(), ["Yes, trust this folder"]);
				await click("terminal-assist");
				assert.ok(shell.calls.includes("answer trust"));
			});
		} finally {
			shell.remove();
		}
	});

	it("Escape in the screen belongs to the agent; Close closes the panel, the same question does not reopen it, and the status line does", async () => {
		const shell = fakeShell([teacher({ prompt: "menu" })]);
		try {
			await mounted(access(), async (render) => {
				assert.ok(onTerminal());
				for (let i = 0; i < 10 && !document.querySelector("[data-terminal-screen] textarea"); i++) await settle();
				const screen = document.querySelector("[data-terminal-screen]")!;
				let escaped = false;
				const spy = () => (escaped = true);
				document.addEventListener("keydown", spy);
				press(screen, "Escape", 27);
				document.removeEventListener("keydown", spy);
				assert.ok(!escaped, "Escape stays in the screen");
				await click("teacher-panel-close");
				assert.ok(q("teacher-panel") === null, "Close closed it");
				await render(access());
				assert.ok(q("teacher-panel") === null, "not reopened for the same question");
				await click("status");
				assert.ok(onTerminal(), "the status line opens it on Terminal");
			});
		} finally {
			shell.remove();
		}
	});

	it("opens when the teacher has not checked in 20 s after its start", async () => {
		const shell = fakeShell([teacher({ startedAt: Date.now() - 19_700, url: true })]);
		try {
			await mounted(access(), async () => {
				assert.ok(q("teacher-panel") === null, "still starting");
				await act(() => new Promise((r) => setTimeout(r, 500)));
				await settle();
				assert.ok(onTerminal(), "it opened");
				assert.equal(text("status"), "Finish signing in to Claude Code.");
			});
		} finally {
			shell.remove();
		}
	});

	it("when the window comes back after the system held its timers, a 20 s that passed meanwhile opens it at once", async () => {
		const shell = fakeShell([teacher({ startedAt: Date.now() - 10_000 })]);
		const realNow = Date.now;
		try {
			await mounted(access(), async () => {
				assert.ok(q("teacher-panel") === null, "still starting");
				// 15 s pass with no timer firing, as in a background window.
				Date.now = () => realNow() + 15_000;
				await act(async () => void dom.window.dispatchEvent(new dom.window.Event("focus")));
				await settle();
				assert.ok(onTerminal(), "it opened");
				assert.equal(text("status"), "Ada hasn't started teaching yet.");
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
				assert.ok(q("teacher-panel") === null, "running quietly");
				await act(async () => shell.push({ id: "t1", ended: { stopped: false, code: 1 }, prompt: null, url: false }));
				await settle();
				assert.ok(onTerminal(), "it opened");
				assert.equal(text("terminal-footer"), "The last lines are above.");
				assert.ok(q("terminal-stop") === null, "nothing to stop");
				assert.deepEqual(bright(), ["Start again"]);
				await click("terminal-start-again");
				assert.ok(shell.calls.includes("start teacher claude"));
			});
		} finally {
			shell.remove();
		}
	});

	it("an open panel on another tab stays there: the Terminal tab is marked and the status line says what is needed", async () => {
		const shell = fakeShell([teacher()]);
		try {
			await mounted(access({ teaching: true, terminals: [{ id: "t1", here: true }] }), async (render) => {
				await click("open-activity");
				assert.ok(q("teacher-tab-terminal-mark") === null, "nothing needed yet");
				await act(async () => shell.push({ id: "t1", ended: null, prompt: "enter", url: false }));
				await settle();
				assert.ok(selected("activity"), "the learner stays on Activity");
				assert.ok(q("teacher-tab-terminal-mark") !== null, "the Terminal tab is marked");
				assert.equal(q("teacher-tab-terminal")?.getAttribute("aria-description"), "Ada needs you here");
				assert.equal(text("teacher-panel-agent"), "Claude Code is asking you to continue.");
				await click("teacher-panel-close");
				await render(access({ teaching: true, terminals: [{ id: "t1", here: true }] }));
				assert.ok(q("teacher-panel") === null, "closing it does not bring the same need back");
				await click("open-activity");
				await click("teacher-tab-terminal");
				assert.ok(onTerminal() && q("teacher-tab-terminal-mark") === null, "the tab shows it, unmarked");
				assert.deepEqual(bright(), ["Continue"]);
			});
		} finally {
			shell.remove();
		}
	});

	it("never over a dialog: it waits for the dialog to close", async () => {
		const shell = fakeShell([teacher({ prompt: "menu" })]);
		const dialog = document.createElement("div");
		dialog.setAttribute("aria-modal", "true");
		document.body.append(dialog);
		try {
			await mounted(access(), async () => {
				assert.ok(q("teacher-panel") === null, "a dialog is open");
				dialog.remove();
				await act(() => new Promise((r) => setTimeout(r, 1100)));
				await settle();
				assert.ok(onTerminal(), "it opened after the dialog closed");
			});
		} finally {
			dialog.remove();
			shell.remove();
		}
	});
});

describe("the screens", () => {
	it("a running teacher: no bright key, Stop is there, and a helper gets the switch beside the tabs", async () => {
		const shell = fakeShell([teacher(), teacher({ id: "h1", role: "helper" })]);
		try {
			await mounted(access({ teaching: true, terminals: [{ id: "t1", here: true }, { id: "h1", here: true }] }), async () => {
				assert.equal(text("status"), "Teaching, idle");
				await click("status");
				assert.equal(text("terminal-footer"), "", "the status line says it teaches");
				assert.deepEqual(bright(), []);
				assert.equal(q("terminal-screen-teacher")?.getAttribute("aria-pressed"), "true");
				await click("terminal-screen-helper");
				assert.equal(text("terminal-footer"), "The helper is waiting for files to read.");
				await click("terminal-stop");
				assert.ok(shell.calls.includes("stop h1"));
			});
		} finally {
			shell.remove();
		}
	});

	it("before any start: what shows here and the start pair at Talk's width, which starts the teacher here and widens for its screen; beside an agent from outside godspeed, where its screen is", async () => {
		const shell = fakeShell();
		const wasWidth = dom.window.innerWidth;
		Object.assign(dom.window, { innerWidth: 1440 });
		try {
			stored.set("lh-folder-agent", "codex");
			await mounted(access(), async () => {
				await click("open-activity");
				await click("teacher-tab-terminal");
				assert.equal(text("terminal-none"), "Ada's screen shows here once it starts.Start CodexUse another agent");
				assert.ok(!/not connected/i.test(text("terminal-none") ?? ""), "the status line says that");
				assert.equal(q("teacher-panel")?.style.width, "400px", "nothing to show yet: Talk's width");
				assert.equal(q("open-agent")?.textContent, "Start Codex", "the agent last started here");
				await click("open-agent");
				assert.ok(shell.calls.includes("start teacher codex"));
				assert.equal(q("teacher-panel")?.style.width, "894px", "its screen shows: wide");
				assert.equal(text("status"), "Ada is starting.");
				assert.equal(text("terminal-footer"), "If Codex asks you something, answer it here.");
			});
		} finally {
			Object.assign(dom.window, { innerWidth: wasWidth });
			shell.remove();
		}
		const outside = fakeShell();
		try {
			await mounted(access({ connected: true, teaching: true, outsideHere: true }), async () => {
				await click("open-activity");
				await click("teacher-tab-terminal");
				assert.equal(text("terminal-none"), "Your agent was started outside godspeed, so its screen is in its own window.");
			});
		} finally {
			outside.remove();
		}
	});

	it("the way around a failed start shows only once a start failed, with why", async () => {
		const shell = fakeShell();
		const terminals = (dom.window as unknown as { lh: { terminals: { start: () => Promise<never> } } }).lh.terminals;
		terminals.start = () => Promise.reject("The terminal could not start.");
		try {
			await mounted(access(), async () => {
				await click("open-activity");
				await click("teacher-tab-terminal");
				assert.ok(!/run the command/.test(text("no-agent") ?? ""), "not before a start");
				await click("open-agent");
				assert.match(text("no-agent") ?? "", /If that does not work, run the command from Settings, Connection in your terminal\./);
				assert.ok(q("no-agent")?.querySelector("[role='alert']"), "said as an alert");
			});
		} finally {
			shell.remove();
		}
	});

	it("a Start button anywhere opens the panel on Terminal; a start godspeed makes by itself does not", async () => {
		const shell = fakeShell();
		let wake: (() => void) | null = null;
		function Waker() {
			wake = useTerminals()!.wake;
			return null;
		}
		try {
			await mounted(
				access(),
				async () => {
					stored.set("lh-folder-agent", "claude");
					await act(async () => wake!());
					await settle();
					assert.ok(shell.calls.includes("start teacher claude"), "woke the teacher");
					assert.ok(q("teacher-panel") === null, "hidden");
				},
				<Waker />,
			);
		} finally {
			shell.remove();
		}
		const again = fakeShell();
		try {
			await mounted(
				access(),
				async () => {
					assert.ok(q("teacher-panel") === null);
					await click("no-agent-open");
					assert.ok(again.calls.includes("start teacher claude"));
					assert.ok(onTerminal(), "the learner sees it start");
				},
				<NoAgentLine />,
			);
		} finally {
			again.remove();
		}
	});
});

describe("the keyboard", () => {
	it("opening by itself takes no keys: the box the learner types in keeps them; opened by the learner, the screen takes them", async () => {
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
				assert.ok(onTerminal(), "a permission menu opened it");
				assert.ok(screen() !== null, "the screen drew");
				assert.ok(focused === box, "the box kept the keyboard");
				press(box, "1", 49);
				press(box, "Enter", 13);
				assert.ok(!wrote(), "no key reached the agent");
				await click("teacher-panel-close");
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
	it("a step after the agent step says what the teacher needs, and its button shows the screen there without the keyboard; the panel does not open for it later", async () => {
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
		const page = (done: boolean) => <TerminalsProvider status={status}>{done ? <PanelHost /> : <Step />}</TerminalsProvider>;
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
			assert.ok(q("teacher-panel") === null, "already seen in the step");
		} finally {
			proto.focus = realFocus;
			await act(async () => root.unmount());
			await settle();
			host.remove();
			shell.remove();
		}
	});

	it("the step's own screen takes no keys and counts as seen; a question past the step opens the panel once there is one", async () => {
		const shell = fakeShell([teacher({ prompt: "menu" }), teacher({ id: "h1", role: "helper" })]);
		const proto = dom.window.HTMLElement.prototype as { focus: () => void };
		const realFocus = proto.focus;
		let focused = 0;
		proto.focus = () => void focused++;
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		const status = access({ terminals: [{ id: "t1", here: true }, { id: "h1", here: true }] });
		const page = (step: "agent" | "next" | "done") => (
			<TerminalsProvider status={status}>
				{step === "agent" && <FirstRunScreen />}
				{step === "done" && <PanelHost />}
			</TerminalsProvider>
		);
		try {
			await act(async () => root.render(page("agent")));
			for (let i = 0; i < 10 && !document.querySelector("[data-terminal-screen] textarea"); i++) await settle();
			assert.ok(q("first-run-screen") !== null);
			assert.ok(focused === 0, "no focus until a click");
			await act(async () => root.render(page("next")));
			await act(async () => shell.push({ id: "h1", ended: null, prompt: "menu", url: false }));
			await settle();
			await act(async () => root.render(page("done")));
			await settle();
			assert.ok(onTerminal(), "the helper's question opens the panel after onboarding");
			assert.equal(q("terminal-screen-helper")?.getAttribute("aria-pressed"), "true", "on the helper's screen");
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
				assert.equal(text("terminal-footer"), "godspeed made the folder for it.");
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
