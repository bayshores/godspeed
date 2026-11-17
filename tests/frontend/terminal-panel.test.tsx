/**
 * The agent's screen in the teacher panel and the teacher's status line:
 * what opens it by itself, the lit chip while the Activity list hangs over
 * it, background work's screen only while it needs the learner, its one
 * bright key, the Start buttons that open it, the starter keys of an
 * unused chat, and the web version, which has no terminals and keeps its
 * plain status line.
 */
import { dom, fakeShell, press } from "../terminal-dom.ts";
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { TerminalRecord } from "../../src/frontend/components/terminal/terminal-model.ts";
import type { TeacherApi } from "../../src/frontend/components/teacher/teacher-context.ts";

const { MemoryRouter } = await import("react-router");
const { TerminalsProvider, useTerminals } = await import("../../src/frontend/components/terminal/use-terminals.ts");
const { TeacherStatus } = await import("../../src/frontend/components/terminal/teacher-status.tsx");
const { RestartDialog } = await import("../../src/frontend/components/terminal/restart-dialog.tsx");
const { AgentNeed } = await import("../../src/frontend/components/onboarding/agent-need.tsx");
const { TeacherPanel } = await import("../../src/frontend/components/teacher/teacher-panel.tsx");
const { TeacherContext } = await import("../../src/frontend/components/teacher/teacher-context.ts");
const { useTeacherPanel } = await import("../../src/frontend/components/teacher/use-teacher-panel.ts");
const { panelBody } = await import("../../src/frontend/components/teacher/dock-model.ts");
const { NoAgentLine } = await import("../../src/frontend/components/agent-folder/no-agent-line.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { FirstRunScreen } = await import("../../src/frontend/components/terminal/first-run-screen.tsx");
type Access = Parameters<typeof TerminalsProvider>[0]["status"];

const access = (over: Partial<NonNullable<Access>> = {}): Access => ({ connected: false, teaching: false, helperHere: false, helperCovering: false, pendingWork: 0, pendingTurns: 0, helperWork: 0, claimedLessons: [], terminals: [], outsideHere: false, ...over });
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

/** The teacher's panel as the provider holds it. */
function PanelHost({ children }: { children?: React.ReactNode }) {
	const panel = useTeacherPanel();
	const view = panelBody(!!useTerminals()?.available);
	const api: TeacherApi = {
		name: "Ada",
		follow: false,
		setFollow: () => {},
		panelOpen: panel.open,
		panelStarts: false,
		setPanelOpen: panel.setOpen,
		showTerminal: panel.showTerminal,
		recent: [],
		doing: null,
		setLesson: () => {},
		go: () => {},
		offer: null,
		held: false,
		spaceNameOf: () => null,
	};
	return (
		<TeacherContext.Provider value={api}>
			<TeacherStatus name="Ada" line="Ready" testid="status" />
			<button type="button" data-testid="open-panel" onClick={() => panel.setOpen(true)} />
			<button type="button" data-testid="open-terminal" onClick={() => panel.showTerminal()} />
			{children}
			{panel.open && (
				<TeacherPanel
					name="Ada"
					agent={null}
					view={view}
					list={panel.list}
					onList={panel.setList}
					screen={panel.role}
					onScreen={panel.showTerminal}
					focus={panel.focus}
					state="open"
				/>
			)}
		</TeacherContext.Provider>
	);
}

const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));
const q = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const text = (testid: string) => q(testid)?.textContent ?? null;
/** The panel open on an agent's screen, or on the outline of one to come. */
const onTerminal = () => q("teacher-panel") !== null && (q("terminal-footer") !== null || q("terminal-none") !== null);
/** A key that went away has faded out. */
const faded = () => act(() => new Promise((r) => setTimeout(r, 150)));
const bright = () => [...document.querySelectorAll('[data-testid="teacher-panel"] .lh-btn-main')].map((b) => b.textContent);
const click = async (testid: string) => {
	const el = q(testid);
	assert.ok(el !== null, `${testid} shows`);
	await act(async () => el.click());
	await settle();
};

/** The server's events the page listens for; `say` sends one. */
const listening = new Map<string, (data: string) => void>();
const noEvents = () => ({ onEvent: (name: string, cb: (data: string) => void) => void listening.set(name, cb), onOpen() {}, close() {} });
const say = async (name: string) => {
	await act(async () => listening.get(name)?.("{}"));
	await settle();
};

async function mounted(status: Access, run: (render: (s: Access, extra?: React.ReactNode) => Promise<void>) => Promise<void>, extra?: React.ReactNode) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const render = async (s: Access, more: React.ReactNode = extra) => {
		await act(async () =>
			root.render(
				<MemoryRouter>
					<ServerEventsProvider connect={noEvents as never}>
						<TerminalsProvider status={s}>
							<PanelHost>{more}</PanelHost>
						</TerminalsProvider>
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
	it("has no terminals: the status line is plain text and the panel is Activity alone", async () => {
		delete (dom.window as { lh?: unknown }).lh;
		await mounted(access({ teaching: true }), async () => {
			const status = q("status");
			assert.ok(status?.tagName === "SPAN", "plain text, not a button");
			assert.equal(status?.textContent, "Ready");
			await click("open-panel");
			assert.ok(q("activity-list") !== null, "Activity is the panel's body");
			assert.ok(document.querySelector("[data-testid='teacher-panel'] [aria-expanded]") === null, "no list to drop");
		});
	});
});

describe("never opening by itself", () => {
	it("the trust question waits in the status line; a click there opens the screen with its one bright key", async () => {
		const shell = fakeShell([teacher({ prompt: "trust" })]);
		try {
			await mounted(access(), async () => {
				assert.equal(text("status"), "Claude Code asks to trust its folder.");
				assert.ok(q("teacher-panel") === null, "the panel stays shut");
				await click("status");
				assert.ok(onTerminal());
				assert.equal(text("terminal-footer"), "", "the chip already asks");
				assert.deepEqual(bright(), ["Trust folder"]);
				await click("terminal-assist");
				assert.ok(shell.calls.includes("answer trust"));
			});
		} finally {
			shell.remove();
		}
	});

	it("Escape in the screen belongs to the agent", async () => {
		const shell = fakeShell([teacher({ prompt: "menu" })]);
		try {
			await mounted(access(), async () => {
				await click("status");
				for (let i = 0; i < 10 && !document.querySelector("[data-terminal-screen] textarea"); i++) await settle();
				const screen = document.querySelector("[data-terminal-screen]")!;
				let escaped = false;
				const spy = () => (escaped = true);
				document.addEventListener("keydown", spy);
				press(screen, "Escape", 27);
				document.removeEventListener("keydown", spy);
				assert.ok(!escaped, "Escape stays in the screen");
			});
		} finally {
			shell.remove();
		}
	});

	it("a teacher not checked in 20 s after its start, also after the system held the timers, says so and stays shut", async () => {
		const shell = fakeShell([teacher({ startedAt: Date.now() - 19_700, url: true })]);
		try {
			await mounted(access(), async () => {
				await act(() => new Promise((r) => setTimeout(r, 500)));
				await settle();
				assert.equal(text("status"), "Finish signing in to Claude Code.");
				assert.ok(q("teacher-panel") === null);
			});
		} finally {
			shell.remove();
		}
		const held = fakeShell([teacher({ startedAt: Date.now() - 10_000 })]);
		const realNow = Date.now;
		try {
			await mounted(access(), async () => {
				// 15 s pass with no timer firing, as in a background window.
				Date.now = () => realNow() + 15_000;
				await act(async () => void dom.window.dispatchEvent(new dom.window.Event("focus")));
				await settle();
				assert.equal(text("status"), "Ada hasn't started teaching yet.");
				assert.ok(q("teacher-panel") === null);
			});
		} finally {
			Date.now = realNow;
			held.remove();
		}
	});

	it("after a crash the screen has Start again as the bright key", async () => {
		const shell = fakeShell([teacher()]);
		try {
			await mounted(access({ terminals: [{ id: "t1", here: true }] }), async () => {
				await act(async () => shell.push({ id: "t1", ended: { stopped: false, code: 1 }, prompt: null, url: false }));
				await settle();
				assert.ok(q("teacher-panel") === null, "still shut");
				await click("status");
				await faded();
				assert.equal(text("terminal-footer"), "", "the chip says it closed");
				assert.ok(q("terminal-stop") === null, "nothing to stop");
				assert.deepEqual(bright(), ["Start again"]);
				await click("terminal-start-again");
				assert.ok(shell.calls.includes("start teacher claude"));
			});
		} finally {
			shell.remove();
		}
	});

	it("a chat the agent says is gone ends with New chat as the bright key, which starts a new one", async () => {
		const shell = fakeShell([teacher()]);
		try {
			await mounted(access({ terminals: [{ id: "t1", here: true }] }), async () => {
				await act(async () => shell.push({ id: "t1", ended: { stopped: false, code: 5 }, prompt: null, url: false }));
				await settle();
				await click("status");
				await faded();
				assert.deepEqual(bright(), ["New chat"]);
				await click("terminal-start-again");
				assert.ok(shell.calls.includes("start teacher claude"));
			});
		} finally {
			shell.remove();
		}
	});

	it("an open Activity list stays while the status lights up and says what is needed", async () => {
		const shell = fakeShell([teacher()]);
		try {
			await mounted(access(), async () => {
				await click("open-terminal");
				await click("teacher-panel-activity");
				assert.ok(q("teacher-panel-list")?.querySelector("[data-testid='activity-list']"), "the list hangs from the head");
				const lit = () => q("teacher-panel-agent")?.classList.contains("bg-highlight") === true;
				assert.ok(!lit(), "nothing needed yet");
				await act(async () => shell.push({ id: "t1", ended: null, prompt: "enter", url: false }));
				await settle();
				assert.ok(q("teacher-panel-list") !== null, "the list stays open");
				assert.ok(lit(), "the chip is lit");
				assert.equal(text("teacher-panel-agent"), "Claude Code is asking you to continue.");
				await click("teacher-panel-activity");
				await faded();
				assert.ok(q("teacher-panel-list") === null, "Activity closes the list");
				assert.deepEqual(bright(), ["Continue"]);
			});
		} finally {
			shell.remove();
		}
	});

	it("Activity drops its list over the screen with the keyboard in it; Esc gives it back to Activity, a click outside just closes it", async () => {
		const shell = fakeShell([teacher()]);
		const proto = dom.window.HTMLElement.prototype as { focus: () => void };
		const realFocus = proto.focus;
		let focused: unknown = null;
		proto.focus = function (this: unknown) {
			focused = this;
		};
		try {
			await mounted(access(), async () => {
				await click("open-terminal");
				assert.equal(text("teacher-panel-agent"), "Ada is starting.");
				assert.ok(q("teacher-panel-list") === null);
				assert.equal(q("teacher-panel-agent")!.tagName, "SPAN", "the status only tells");
				const chip = q("teacher-panel-activity")!;
				assert.equal(chip.getAttribute("aria-expanded"), "false");
				assert.ok(!chip.hasAttribute("aria-controls"), "names no list while there is none");
				await click("teacher-panel-activity");
				const list = q("teacher-panel-list");
				assert.ok(list !== null && q("terminal-footer") !== null, "over the screen, which stays");
				assert.equal(chip.getAttribute("aria-controls"), list.id);
				assert.ok(focused === list, "the keyboard is in the list");
				await act(async () => void document.dispatchEvent(Object.assign(new dom.window.Event("keydown", { bubbles: true }), { key: "Escape" })));
				await faded();
				assert.ok(q("teacher-panel-list") === null);
				assert.ok(focused === chip, "Esc gives the keyboard back to Activity");
				await click("teacher-panel-activity");
				focused = null;
				await act(async () => void document.body.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true })));
				await faded();
				assert.ok(q("teacher-panel-list") === null);
				assert.ok(focused === null, "a click elsewhere keeps its own focus");
			});
		} finally {
			proto.focus = realFocus;
			shell.remove();
		}
	});
});

describe("the screens", () => {
	it("a running teacher: no bright key, Stop is there, and background work at work adds nothing to the head", async () => {
		const shell = fakeShell([teacher(), teacher({ id: "h1", role: "helper" })]);
		try {
			await mounted(access({ teaching: true, terminals: [{ id: "t1", here: true }, { id: "h1", here: true }] }), async () => {
				assert.equal(text("status"), "Ready");
				await click("status");
				assert.equal(text("terminal-footer"), "", "the status line says it teaches");
				assert.deepEqual(bright(), []);
				assert.equal(text("teacher-panel-name"), null);
				assert.ok(q("teacher-panel-need") === null && q("teacher-panel-back") === null);
				assert.ok(!/helper/i.test(q("teacher-panel")?.textContent ?? ""), "the panel never says helper");
				await click("terminal-stop");
				assert.ok(shell.calls.includes("stop t1"));
			});
		} finally {
			shell.remove();
		}
	});

	it("background work that needs the learner: a lit key goes to its screen, Back returns, and once answered the panel goes back by itself", async () => {
		const shell = fakeShell([teacher(), teacher({ id: "h1", role: "helper" })]);
		try {
			await mounted(access({ teaching: true, terminals: [{ id: "t1", here: true }, { id: "h1", here: true }] }), async () => {
				await click("status");
				await act(async () => shell.push({ id: "h1", ended: null, prompt: "menu", url: false }));
				await settle();
				assert.equal(text("teacher-panel-name"), null, "the learner stays on the teacher's screen");
				assert.equal(text("teacher-panel-need"), "Background work needs you");
				await click("teacher-panel-need");
				await faded();
				assert.equal(text("teacher-panel-name"), "Background work");
				assert.equal(text("teacher-panel-agent"), "Claude Code is asking you something.");
				assert.ok(q("teacher-panel-agent")?.classList.contains("bg-highlight"), "its chip carries the need");
				assert.equal(text("terminal-footer"), "", "the chip already says what");
				assert.ok(q("teacher-panel-need") === null && q("terminal-attach") === null);
				await click("teacher-panel-back");
				assert.equal(text("teacher-panel-name"), null);
				await click("teacher-panel-need");
				await act(async () => shell.push({ id: "h1", ended: null, prompt: null, url: false }));
				await settle();
				assert.equal(text("teacher-panel-name"), null, "answered: back on the teacher's screen");
				await faded();
				assert.ok(q("teacher-panel-need") === null && q("teacher-panel-back") === null);
			});
		} finally {
			shell.remove();
		}
	});

	it("Attach on the teacher's screen types each picked file's path; a refusal shows under the screen", async () => {
		const shell = fakeShell([teacher()]);
		const terminals = (dom.window as unknown as { lh: { terminals: { addFile: (id: string, name: string, data: string) => Promise<string> } } }).lh.terminals;
		const g = globalThis as Record<string, unknown>;
		const hadReader = g.FileReader;
		// Node has no FileReader: this one reads a Blob as a data URL, as WebKit does.
		g.FileReader = class {
			result: string | null = null;
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			readAsDataURL(blob: Blob) {
				void blob.arrayBuffer().then((b) => {
					this.result = `data:${blob.type};base64,${Buffer.from(b).toString("base64")}`;
					this.onload?.();
				});
			}
		};
		const pick = async (files: File[]) => {
			const input = q("terminal-attach-input") as HTMLInputElement;
			Object.defineProperty(input, "files", { configurable: true, value: files });
			await act(async () => void input.dispatchEvent(new dom.window.Event("change", { bubbles: true })));
			await settle();
		};
		try {
			await mounted(access({ teaching: true, terminals: [{ id: "t1", here: true }] }), async () => {
				await click("status");
				assert.equal(text("terminal-attach"), "Attach");
				await pick([new File(["png"], "week 3.png", { type: "image/png" }), new File(["%PDF-"], "lab.pdf", { type: "application/pdf" })]);
				assert.deepEqual(
					shell.calls.filter((c) => c.startsWith("add ")),
					[`add t1 week 3.png ${btoa("png")}`, `add t1 lab.pdf ${btoa("%PDF-")}`],
					"in order, as base64",
				);
				terminals.addFile = () => Promise.reject("Attach takes pictures (PNG, JPEG, GIF or WebP) and PDFs.");
				await pick([new File(["x"], "notes.txt")]);
				assert.equal(text("terminal-footer"), "Attach takes pictures (PNG, JPEG, GIF or WebP) and PDFs.");
				const big = new File(["x"], "scan.pdf");
				Object.defineProperty(big, "size", { value: 21 * 1024 * 1024 });
				await pick([big]);
				assert.equal(text("terminal-footer"), "That file is over 20 MB.", "refused before it is read");
			});
		} finally {
			g.FileReader = hadReader;
			shell.remove();
		}
	});

	it("before any start: what shows here and the start pair, which starts the teacher here at the same width; beside an agent from outside godspeed, where its screen is", async () => {
		const shell = fakeShell();
		const wasWidth = dom.window.innerWidth;
		Object.assign(dom.window, { innerWidth: 1440 });
		try {
			stored.set("lh-folder-agent", "codex");
			await mounted(access(), async () => {
				await click("open-terminal");
				assert.equal(text("terminal-none"), "Ada's screen shows here.Start CodexUse another agent");
				assert.ok(!/not connected/i.test(text("terminal-none") ?? ""), "the status line says that");
				assert.equal(q("teacher-panel")?.style.width, "620px");
				assert.equal(q("open-agent")?.textContent, "Start Codex", "the agent last started here");
				await click("open-agent");
				assert.ok(shell.calls.includes("start teacher codex"));
				assert.equal(q("teacher-panel")?.style.width, "620px", "its screen shows in the same panel");
				assert.equal(text("teacher-panel-agent"), "Ada is starting.");
				assert.equal(text("status"), "Ready", "the open panel's head says it: the line beside it does not say it again");
				assert.equal(text("terminal-footer"), "");
			});
		} finally {
			Object.assign(dom.window, { innerWidth: wasWidth });
			shell.remove();
		}
		const outside = fakeShell();
		try {
			await mounted(access({ connected: true, teaching: true, outsideHere: true }), async () => {
				await click("open-terminal");
				assert.equal(text("terminal-none"), "Your agent runs in its own window.");
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
				await click("open-terminal");
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
	it("a need that comes or goes by itself takes no keys: the box the learner types in keeps them; opened by the learner, the screen takes them", async () => {
		const shell = fakeShell([teacher(), teacher({ id: "h1", role: "helper" })]);
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
			await mounted(access({ teaching: true, terminals: [{ id: "t1", here: true }, { id: "h1", here: true }] }), async () => {
				box.focus();
				assert.ok(focused === box, "the learner types in the box");
				await act(async () => shell.push({ id: "t1", ended: null, prompt: "menu", url: false }));
				await settle();
				assert.ok(q("teacher-panel") === null, "a permission menu does not open it");
				assert.ok(focused === box, "the box kept the keyboard");
				press(box, "1", 49);
				press(box, "Enter", 13);
				assert.ok(!wrote(), "no key reached the agent");
				await click("status");
				for (let i = 0; i < 10 && !screen(); i++) await settle();
				assert.ok(focused === screen(), "opened by the learner, the screen takes the keyboard");
				await act(async () => shell.push({ id: "t1", ended: null, prompt: null, url: false }));
				await act(async () => shell.push({ id: "h1", ended: null, prompt: "menu", url: false }));
				await settle();
				await click("teacher-panel-need");
				for (let i = 0; i < 10 && !screen(); i++) await settle();
				box.focus();
				await act(async () => shell.push({ id: "h1", ended: null, prompt: null, url: false }));
				await settle();
				for (let i = 0; i < 10 && !screen(); i++) await settle();
				assert.equal(text("teacher-panel-name"), null, "back on the teacher's screen by itself");
				assert.ok(focused === box, "which leaves the keyboard in the box");
			});
		} finally {
			proto.focus = realFocus;
			box.remove();
			shell.remove();
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

describe("the footer", () => {
	it("shows only keys that act now: Stop while starting, Paste once asked, Attach once running, Start again once ended", async () => {
		const shell = fakeShell([teacher()]);
		const keys = () => ["terminal-attach", "terminal-paste", "terminal-stop", "terminal-start-again"].filter((k) => q(k) !== null);
		try {
			await mounted(access(), async () => {
				await click("open-terminal");
				assert.deepEqual(keys(), ["terminal-stop"], "starting");
				await act(async () => shell.push({ id: "t1", ended: null, prompt: null, url: true }));
				await settle();
				assert.deepEqual(keys(), ["terminal-paste", "terminal-stop"], "a sign-in asks for a code");
				await act(async () => shell.push({ id: "t1", ended: { stopped: true, code: null }, prompt: null, url: false }));
				await settle();
				await faded();
				assert.deepEqual(keys(), ["terminal-start-again"], "ended");
			});
		} finally {
			shell.remove();
		}
	});


	it("a refused Paste shows until the screen asks something else", async () => {
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
				assert.equal(text("terminal-footer"), "", "the chip asks");
			});
		} finally {
			shell.remove();
		}
	});
});

describe("the starter keys", () => {
	const running = access({ teaching: true, terminals: [{ id: "t1", here: true }] });
	const starters = () => [...document.querySelectorAll('[data-testid="terminal-starter"]')].map((b) => b.textContent);

	it("an unused chat shows three keys under Try asking; a click sends its words and the row goes", async () => {
		const shell = fakeShell([teacher()]);
		try {
			await mounted(running, async () => {
				await click("status");
				assert.equal(q("terminal-starters")?.firstElementChild?.textContent, "Try asking");
				assert.deepEqual(starters(), ["What should I study?", "What's due?", "What can you do?"]);
				assert.equal(document.querySelector('[data-testid="terminal-starter"]')?.getAttribute("title"), "What should I study?", "the first key's full words, for when it is cut");
				await click("terminal-starter");
				assert.ok(shell.calls.includes("send What should I study?"));
				await faded();
				assert.ok(q("terminal-starters") === null);
			});
		} finally {
			shell.remove();
		}
	});

	it("a refused send says why and brings the row back", async () => {
		const shell = fakeShell([teacher()]);
		const terminals = (dom.window as unknown as { lh: { terminals: { send: () => Promise<void> } } }).lh.terminals;
		terminals.send = () => Promise.reject("Show the terminal and click in it first.");
		try {
			await mounted(running, async () => {
				await click("status");
				await click("terminal-starter");
				assert.equal(text("terminal-footer"), "Show the terminal and click in it first.");
				assert.equal(starters().length, 3);
			});
		} finally {
			shell.remove();
		}
	});

	it("none while the screen asks or a lesson turn waits", async () => {
		const shell = fakeShell([teacher()]);
		try {
			await mounted(running, async (render) => {
				await click("status");
				assert.equal(starters().length, 3);
				await act(async () => shell.push({ id: "t1", ended: null, prompt: "menu", url: false }));
				await settle();
				await faded();
				assert.ok(q("terminal-starters") === null, "a question");
				await act(async () => shell.push({ id: "t1", ended: null, prompt: null, url: false }));
				await settle();
				assert.equal(starters().length, 3);
				await render(access({ teaching: true, pendingTurns: 1, terminals: [{ id: "t1", here: true }] }));
				await faded();
				assert.ok(q("terminal-starters") === null, "a turn waits");
			});
		} finally {
			shell.remove();
		}
	});

	it("none once the chat was used, by the learner's own line or before (a chat continued)", async () => {
		const shell = fakeShell([teacher()]);
		let used = false;
		globalThis.fetch = (async (url: string) => Response.json(url.startsWith("/api/teacher-chats") ? { chats: used ? [{ id: "c1", agent: "claude", name: "hi", at: Date.now() }] : [] } : FOLDER)) as unknown as typeof fetch;
		try {
			await mounted(running, async () => {
				await click("status");
				assert.equal(starters().length, 3);
				used = true;
				await say("teacher-chats-changed");
				await faded();
				assert.ok(q("terminal-starters") === null);
			});
		} finally {
			shell.remove();
		}
	});

	it("none in onboarding", async () => {
		const shell = fakeShell([teacher()]);
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		try {
			await act(async () =>
				root.render(
					<ServerEventsProvider connect={noEvents as never}>
						<TerminalsProvider status={running}>
							<FirstRunScreen />
						</TerminalsProvider>
					</ServerEventsProvider>,
				),
			);
			await settle();
			assert.ok(q("first-run-screen") !== null);
			assert.ok(q("terminal-starters") === null);
		} finally {
			await act(async () => root.unmount());
			await settle();
			host.remove();
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
