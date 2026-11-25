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
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { AgentFolderProvider } = await import("../../src/frontend/components/agent-folder/agent-folder-context.tsx");
const { TerminalWindow } = await import("../../src/frontend/components/terminal/terminal-window.tsx");
const { FirstRunScreen } = await import("../../src/frontend/components/terminal/first-run-screen.tsx");
type Access = Parameters<typeof TerminalsProvider>[0]["status"];

const access = (over: Partial<NonNullable<Access>> = {}): Access => ({ connected: false, turnsRunning: 0, terminals: [], outsideHere: false, ...over });
const teacher = (over: Partial<TerminalRecord> = {}): TerminalRecord => ({ id: "t1", agent: "claude", startedAt: Date.now(), ended: null, prompt: null, url: false, ...over });
const FOLDER = { folder: "/home/ada/godspeed", short: "~/godspeed", exists: true, commands: { claude: "claude", codex: "codex" }, startCommands: {}, oldSetup: { plugin: false, codex: false }, agent: "claude" as string | null };

const realFetch = globalThis.fetch;
const stored = new Map<string, string>();
beforeEach(() => {
	stored.clear();
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v), removeItem: (k: string) => void stored.delete(k) },
	});
	// The Activity list asks for the open space's graph costs: none here. The folder keeps the agent a pick (PATCH) sends.
	let folder = FOLDER;
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		if (url.startsWith("/api/graph/costs")) return new Response(null, { status: 404 });
		if (init?.method === "PATCH") folder = { ...folder, agent: JSON.parse(String(init.body)).agent };
		return Response.json(folder);
	}) as unknown as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

/** Whether the page the host stands for is Home. */
let onHome = false;

/** The teacher's panel as the provider holds it. */
function PanelHost({ children }: { children?: React.ReactNode }) {
	const panel = useTeacherPanel(null, onHome);
	const [line, setLine] = React.useState<string | null>(null);
	// The provider clears a line when the panel closes unsent.
	React.useEffect(() => {
		if (!panel.open) setLine(null);
	}, [panel.open]);
	const terminals = useTerminals();
	const view = panelBody(!!terminals?.available, !!terminals?.popped);
	const api: TeacherApi = {
		name: "Ada",
		follow: false,
		setFollow: () => {},
		panelOpen: panel.open,
		setPanelOpen: panel.setOpen,
		showTerminal: panel.showTerminal,
		canAsk: true,
		ask: (l) => {
			setLine(l);
			panel.showTerminal();
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
			<button type="button" data-testid="open-terminal" onClick={() => panel.showTerminal()} />
			<button type="button" data-testid="ask-find" onClick={() => api.ask("Find sums in my files")} />
			<button type="button" data-testid="close-panel" onClick={() => panel.setOpen(false)} />
			{children}
			{panel.open && (
				<TeacherPanel
					name="Ada"
					agent={null}
					view={view}
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
	it("has no terminals: the status line is plain text and the panel is Activity alone", async () => {
		delete (dom.window as { lh?: unknown }).lh;
		await mounted(access({ }), async () => {
			const status = q("status");
			assert.ok(status?.tagName === "SPAN", "plain text, not a button");
			assert.equal(status?.textContent, "Ready");
			await click("open-panel");
			assert.ok(q("activity-list") !== null, "Activity is the panel's body");
			assert.ok(document.querySelector("[data-testid='teacher-panel'] [aria-expanded]") === null, "no list to drop");
		});
	});
});

describe("opening by itself", () => {
	it("the trust question waits in the status line; a click there opens the screen with its one bright key", async () => {
		const shell = fakeShell([teacher({ prompt: "trust" })]);
		try {
			await mounted(access(), async () => {
				assert.equal(text("status"), "Ada asks to trust its folder.");
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

	it("a question that comes opens the panel; answered, the panel it opened goes, but one the learner opened stays", async () => {
		const shell = fakeShell([teacher()]);
		try {
			await mounted(access({ terminals: [{ id: "t1", here: true }] }), async () => {
				assert.ok(q("teacher-panel") === null);
				await act(async () => shell.push({ id: "t1", ended: null, prompt: "menu", url: false }));
				await settle();
				assert.ok(q("teacher-panel") !== null, "the question opened it");
				await act(async () => shell.push({ id: "t1", ended: null, prompt: null, url: false }));
				await settle();
				assert.ok(q("teacher-panel") === null, "answered: it went");
				await click("open-terminal");
				await act(async () => shell.push({ id: "t1", ended: null, prompt: "menu", url: false }));
				await settle();
				await act(async () => shell.push({ id: "t1", ended: null, prompt: null, url: false }));
				await settle();
				assert.ok(q("teacher-panel") !== null, "the learner opened it, so it stays");
			});
		} finally {
			shell.remove();
		}
	});

	it("a panel the learner closed does not come back for a question that was already there", async () => {
		const shell = fakeShell([teacher({ prompt: "menu" })]);
		try {
			await mounted(access({ terminals: [{ id: "t1", here: true }] }), async () => {
				assert.ok(q("teacher-panel") === null, "a question there at the start is no change");
				await click("open-terminal");
				await click("close-panel");
				await faded();
				assert.ok(q("teacher-panel") === null);
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

	it("a teacher not checked in 20 s after its start, also after the system held the timers, says so and opens the panel without the keyboard", async () => {
		const shell = fakeShell([teacher({ startedAt: Date.now() - 19_700, url: true })]);
		try {
			await mounted(access(), async () => {
				await act(() => new Promise((r) => setTimeout(r, 500)));
				await settle();
				assert.equal(text("teacher-panel-agent"), "Finish signing in to Claude Code.");
				assert.ok(q("teacher-panel") !== null, "the need opened it");
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
				assert.equal(text("teacher-panel-agent"), "Ada hasn't started teaching yet.");
				assert.ok(q("teacher-panel") !== null, "the need opened it");
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
				assert.ok(q("teacher-panel") !== null, "the crash opened it");
				await faded();
				assert.equal(text("terminal-footer"), "", "the chip says it closed");
				assert.ok(q("terminal-stop") === null, "nothing to stop");
				assert.deepEqual(bright(), ["Start again"]);
				await click("terminal-start-again");
				assert.ok(shell.calls.includes("start claude"));
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
				assert.ok(shell.calls.includes("start claude"));
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
				assert.equal(text("teacher-panel-agent"), "Ada is asking you to continue.");
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
	it("a running teacher: no bright key, Stop is there", async () => {
		const shell = fakeShell([teacher()]);
		try {
			await mounted(access({ terminals: [{ id: "t1", here: true }] }), async () => {
				assert.equal(text("status"), "Ready");
				await click("status");
				assert.equal(text("terminal-footer"), "", "the status line says it teaches");
				assert.deepEqual(bright(), []);
				assert.equal(text("terminal-stop"), "Turn off Ada", "says it ends the whole agent");
				await click("terminal-stop");
				assert.ok(shell.calls.includes("stop t1"));
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
			await mounted(access({ terminals: [{ id: "t1", here: true }] }), async () => {
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
			// An older godspeed kept it in the window: it goes to the server, which keeps it from then on.
			stored.set("lh-folder-agent", "codex");
			await mounted(access(), async () => {
				assert.equal(stored.get("lh-folder-agent"), undefined, "the window no longer keeps it");
				await click("open-terminal");
				assert.equal(text("terminal-none"), "Ada's screen shows here.Start CodexUse another agent");
				assert.ok(!/not connected/i.test(text("terminal-none") ?? ""), "the status line says that");
				assert.equal(q("teacher-panel")?.style.width, "620px");
				assert.equal(q("open-agent")?.textContent, "Start Codex", "the server's agent");
				await click("open-agent");
				assert.ok(shell.calls.includes("start codex"));
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
			await mounted(access({ connected: true, outsideHere: true }), async () => {
				await click("open-terminal");
				assert.equal(text("terminal-none"), "Ada runs in its own window.");
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
});

describe("the keyboard", () => {
	it("a need that comes or goes by itself takes no keys: the box the learner types in keeps them; opened by the learner, the screen takes them", async () => {
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
			await mounted(access({ terminals: [{ id: "t1", here: true }] }), async () => {
				box.focus();
				assert.ok(focused === box, "the learner types in the box");
				await act(async () => shell.push({ id: "t1", ended: null, prompt: "menu", url: false }));
				await settle();
				assert.ok(q("teacher-panel") !== null, "a permission menu opens it");
				assert.ok(focused === box, "the box kept the keyboard");
				press(box, "1", 49);
				press(box, "Enter", 13);
				assert.ok(!wrote(), "no key reached the agent");
				await click("open-terminal");
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
			await mounted(access({ terminals: [{ id: "t1", here: true }] }), async () => {
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

describe("the Chats key in the panel's head", () => {
	const running = access({ terminals: [{ id: "t1", here: true }] });
	const chats = [
		{ id: "0f8fad5b-d9cb-469f-a165-70867728950e", agent: "claude", name: "Limits proof", at: Date.now(), open: true },
		{ id: "7c9e6679-7425-40de-944b-e07fc1f90ae7", agent: "claude", name: "Slope", at: Date.now() - 3_600_000, open: false },
	];
	const withChats = (list: unknown[]) => {
		globalThis.fetch = (async (url: string) =>
			url.startsWith("/api/graph/costs") ? new Response(null, { status: 404 }) : Response.json(url.startsWith("/api/teacher-chats") ? { chats: list } : FOLDER)) as unknown as typeof fetch;
	};

	it("no key with no chat to go back to, or before the teacher has a screen (the screen lists them)", async () => {
		const shell = fakeShell([teacher()]);
		try {
			withChats([]);
			await mounted(running, async () => {
				await click("status");
				assert.ok(q("teacher-panel-chats") === null);
			});
		} finally {
			shell.remove();
		}
		const none = fakeShell([]);
		try {
			withChats(chats);
			await mounted(access(), async () => {
				await click("open-terminal");
				assert.ok(q("teacher-chats") !== null, "the screen lists the chats");
				assert.ok(q("teacher-panel-chats") === null);
			});
		} finally {
			none.remove();
		}
	});

	it("it drops the chats, the open one marked; Activity takes its place; a pick turns the teacher off and starts it in that chat", async () => {
		const shell = fakeShell([teacher()]);
		try {
			withChats(chats);
			await mounted(running, async () => {
				await click("status");
				await click("teacher-panel-chats");
				const list = q("teacher-panel-list");
				assert.equal(list?.getAttribute("aria-label"), "Chats");
				assert.equal(list?.querySelector("[data-testid='teacher-chat-open']")?.textContent, "Limits proofopen now");
				assert.equal(list?.querySelectorAll("[data-testid='teacher-chat']").length, 1);
				await click("teacher-panel-activity");
				assert.equal(q("teacher-panel-list")?.getAttribute("aria-label"), "Activity", "one list at a time");
				await click("teacher-panel-chats");
				assert.equal(q("teacher-panel-list")?.getAttribute("aria-label"), "Chats");

				await click("teacher-chat");
				assert.ok(shell.calls.includes("stop t1"), "the running teacher is turned off");
				assert.ok(!shell.calls.some((c) => c.startsWith("start ")), "the start waits for it to end");
				await act(async () => shell.push({ id: "t1", ended: { code: null, stopped: true }, prompt: null, url: false }));
				await settle();
				assert.ok(shell.calls.includes("start claude 7c9e6679-7425-40de-944b-e07fc1f90ae7"), "then it starts in the chat picked");
				await faded();
				assert.ok(q("teacher-panel-list") === null, "the list went once it started");
			});
		} finally {
			shell.remove();
		}
	});
});

describe("a new learner's first look at Home", () => {
	const running = access({ terminals: [{ id: "t1", here: true }] });

	it("opens the panel once, by itself, with the keyboard left where it is; never for anyone else or on another page", async () => {
		const shell = fakeShell([teacher()]);
		try {
			await mounted(running, async () => assert.ok(!onTerminal(), "no mark: nobody just finished onboarding"));
			writeStorage(WELCOME_KEY, "1");
			await mounted(running, async () => assert.ok(!onTerminal(), "not Home"));
			assert.equal(readStorage(WELCOME_KEY), "1", "it still waits for Home");
			onHome = true;
			await mounted(running, async () => {
				assert.ok(onTerminal());
				assert.deepEqual(document.querySelectorAll('[data-testid="terminal-starter"]').length, 3, "with what to ask in front of them");
			});
			assert.equal(readStorage(WELCOME_KEY), null);
			await mounted(running, async () => assert.ok(!onTerminal(), "once"));
		} finally {
			onHome = false;
			writeStorage(WELCOME_KEY, null);
			shell.remove();
		}
	});
});

describe("the starter keys", () => {
	const running = access({ terminals: [{ id: "t1", here: true }] });
	const starters = () => [...document.querySelectorAll('[data-testid="terminal-starter"]')].map((b) => b.textContent);

	// The harness has no space: the lines that start one.
	const FIRST = ["Set up a space from my files", "Teach me a new topic", "Build me a path to a goal"];

	it("an unused chat shows the page's keys under Try asking, then the key for the whole list; a click sends its words and the row folds into Ideas", async () => {
		const shell = fakeShell([teacher()]);
		try {
			await mounted(running, async () => {
				await click("status");
				assert.equal(q("terminal-starters")?.firstElementChild?.textContent, "Try asking");
				assert.deepEqual(starters(), FIRST);
				assert.equal(document.querySelector('[data-testid="terminal-starter"]')?.getAttribute("title"), FIRST[0], "a key's full words, for when it is cut");
				assert.equal(text("terminal-everything"), "Everything Ada can do");
				assert.ok(q("terminal-ideas-key") === null, "the row is there: nothing to bring back");
				await click("terminal-starter");
				assert.ok(shell.calls.includes(`send ${FIRST[0]}`));
				await faded();
				assert.ok(q("terminal-starters") === null);
				assert.equal(text("terminal-ideas-key"), "Ideas");
			});
		} finally {
			shell.remove();
		}
	});

	it("Everything opens the whole list over the screen: a line that works is a key that sends it, one that cannot says what it needs", async () => {
		const shell = fakeShell([teacher()]);
		try {
			await mounted(running, async () => {
				await click("status");
				assert.ok(q("terminal-ideas") === null);
				await click("terminal-everything");
				assert.equal(q("terminal-everything")?.getAttribute("aria-expanded"), "true");
				assert.equal(starters().length, 0, "the list holds those lines, so the row keeps only its key");
				assert.deepEqual([...q("terminal-ideas")!.querySelectorAll("h3")].map((h) => h.textContent), ["Learn", "Deadlines", "Spaces and files", "About you"]);
				const off = [...document.querySelectorAll('[data-testid="terminal-idea-off"]')].map((r) => r.textContent);
				assert.ok(off.includes("Make a cheat sheetneeds a deadline"));
				assert.ok(off.every((line) => line?.includes("needs")));
				assert.ok(document.querySelector('[data-testid="terminal-idea-off"]')?.tagName !== "BUTTON", "no key");
				const quiz = [...document.querySelectorAll<HTMLElement>('[data-testid="terminal-idea"]')].find((b) => b.textContent === "Quiz me on what I've learned");
				await act(async () => quiz!.click());
				await settle();
				assert.ok(shell.calls.includes("send Quiz me on what I've learned"));
				await faded();
				assert.ok(q("terminal-ideas") === null, "the list goes with the line");
				assert.ok(q("terminal-starters") === null);
			});
		} finally {
			shell.remove();
		}
	});

	it("the list closes on Esc and on a click outside it, and the row stays", async () => {
		const shell = fakeShell([teacher()]);
		const realFocus = dom.window.HTMLElement.prototype.focus;
		let focused: unknown = null;
		dom.window.HTMLElement.prototype.focus = function (this: HTMLElement) {
			focused = this;
		};
		try {
			await mounted(running, async () => {
				await click("status");
				await click("terminal-everything");
				assert.ok(focused === q("terminal-ideas"), "the keyboard is in the list, so Esc is not typed into the agent");
				await act(async () => void document.dispatchEvent(Object.assign(new dom.window.Event("keydown", { bubbles: true }), { key: "Escape" })));
				await faded();
				assert.ok(q("terminal-ideas") === null);
				await click("terminal-everything");
				await act(async () => void document.body.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true })));
				await faded();
				assert.ok(q("terminal-ideas") === null);
				assert.equal(starters().length, 3);
				assert.equal(shell.calls.filter((c) => c.startsWith("send ")).length, 0);
			});
		} finally {
			dom.window.HTMLElement.prototype.focus = realFocus;
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

	describe("a line a page key hands the teacher", () => {
		const sends = (shell: { calls: string[] }) => shell.calls.filter((c) => c.startsWith("send "));
		const LINE = "send Find sums in my files";

		it("opens the panel and is sent once, when the teacher can take it, and never again", async () => {
			const shell = fakeShell([teacher()]);
			try {
				await mounted(running, async (render) => {
					assert.ok(q("teacher-panel") === null);
					await click("ask-find");
					assert.ok(q("teacher-panel") !== null, "the panel opens on the teacher's screen");
					assert.deepEqual(sends(shell), [LINE]);
					await render(running);
					await say("teacher-chats-changed");
					assert.deepEqual(sends(shell), [LINE], "not again");
				});
			} finally {
				shell.remove();
			}
		});

		it("waits for the screen to be shown in this window: the shell refuses a line before that", async () => {
			const shell = fakeShell([teacher()]);
			const terminals = (dom.window as unknown as { lh: { terminals: { attach: (id: string) => Promise<void> } } }).lh.terminals;
			let attach!: () => void;
			terminals.attach = () => new Promise<void>((done) => (attach = done));
			try {
				await mounted(running, async () => {
					await click("ask-find");
					assert.ok(q("teacher-panel") !== null);
					assert.deepEqual(sends(shell), [], "checked in, but not attached yet");
					await act(async () => attach());
					await settle();
					assert.deepEqual(sends(shell), [LINE]);
				});
			} finally {
				shell.remove();
			}
		});

		it("waits while the teacher has not checked in, then goes once it has", async () => {
			const shell = fakeShell([teacher()]);
			try {
				await mounted(access({ terminals: [{ id: "t1", here: false }] }), async (render) => {
					await click("ask-find");
					assert.ok(q("teacher-panel") !== null);
					assert.deepEqual(sends(shell), [], "not yet");
					await render(running);
					assert.deepEqual(sends(shell), [LINE]);
				});
			} finally {
				shell.remove();
			}
		});

		it("is dropped when the panel closes unsent", async () => {
			const shell = fakeShell([teacher()]);
			try {
				await mounted(access({ terminals: [{ id: "t1", here: false }] }), async (render) => {
					await click("ask-find");
					await click("close-panel");
					await render(running);
					await click("open-panel");
					assert.deepEqual(sends(shell), [], "the closed panel took the line with it");
				});
			} finally {
				shell.remove();
			}
		});

		it("a refusal shows where a starter key's refusal shows", async () => {
			const shell = fakeShell([teacher()]);
			const terminals = (dom.window as unknown as { lh: { terminals: { send: () => Promise<void> } } }).lh.terminals;
			terminals.send = () => Promise.reject("Show the terminal and click in it first.");
			try {
				await mounted(running, async () => {
					await click("ask-find");
					assert.equal(text("terminal-footer"), "Show the terminal and click in it first.");
				});
			} finally {
				shell.remove();
			}
		});
	});

	it("none while the screen asks", async () => {
		const shell = fakeShell([teacher()]);
		try {
			await mounted(running, async () => {
				await click("status");
				assert.equal(starters().length, 3);
				await act(async () => shell.push({ id: "t1", ended: null, prompt: "menu", url: false }));
				await settle();
				await faded();
				assert.ok(q("terminal-starters") === null, "a question");
				assert.ok(q("terminal-ideas-key") === null, "and no Ideas key");
				await act(async () => shell.push({ id: "t1", ended: null, prompt: null, url: false }));
				await settle();
				assert.equal(starters().length, 3);
			});
		} finally {
			shell.remove();
		}
	});

	it("once the chat was used, by the learner's own line or before (a chat continued), the row is folded into the Ideas key, which brings it back and folds it again", async () => {
		const shell = fakeShell([teacher()]);
		let used = false;
		globalThis.fetch = (async (url: string) => (url.startsWith("/api/graph/costs") ? new Response(null, { status: 404 }) : Response.json(url.startsWith("/api/teacher-chats") ? { chats: used ? [{ id: "c1", agent: "claude", name: "hi", lesson: null, at: Date.now(), open: true }] : [] } : FOLDER))) as unknown as typeof fetch;
		try {
			await mounted(running, async () => {
				await click("status");
				assert.equal(starters().length, 3);
				used = true;
				await say("teacher-chats-changed");
				await faded();
				assert.ok(q("terminal-starters") === null);
				await click("terminal-ideas-key");
				assert.equal(starters().length, 3);
				assert.equal(q("terminal-ideas-key")?.getAttribute("aria-expanded"), "true");
				await click("terminal-ideas-key");
				await faded();
				assert.ok(q("terminal-starters") === null);
				assert.equal(text("terminal-ideas-key"), "Ideas");
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
			assert.ok(q("terminal-ideas-key") === null);
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
			assert.equal(document.querySelector('[data-testid="restart-dialog"] p')?.textContent, "Ada is answering you. Restarting stops Ada.");
			await click("restart-now");
			assert.ok(restarted === 1);
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});
});

describe("the terminal in a window of its own", () => {
	const ON = access({ terminals: [{ id: "t1", here: true }] });
	const attaches = (shell: { calls: string[] }) => shell.calls.filter((c) => c === "attach t1").length;

	it("shows Pop out on the teacher's screen only where the shell has the window", async () => {
		const shell = fakeShell([teacher()]);
		try {
			await mounted(ON, async () => {
				await click("open-terminal");
				assert.equal(q("terminal-pop-out"), null, "an older shell: no window to make");
			});
		} finally {
			shell.remove();
		}
		const withWindow = fakeShell([teacher()], true);
		try {
			await mounted(ON, async () => {
				await click("open-terminal");
				assert.equal(text("terminal-pop-out"), "Pop out");
				await click("terminal-pop-out");
				assert.ok(withWindow.calls.includes("window open Ada"), "titled with the teacher's name");
			});
		} finally {
			withWindow.remove();
		}
	});

	it("while it is open the column shows Activity with Follow and Put back, and no terminal", async () => {
		const shell = fakeShell([teacher()], true);
		try {
			await mounted(ON, async () => {
				await click("open-terminal");
				assert.ok(q("terminal-footer") !== null);
				const before = attaches(shell);
				await act(async () => shell.windowOpen(true));
				await settle();
				assert.ok(q("teacher-panel") === null, "the column closes: the page gets its room back");
				await click("open-panel");
				assert.ok(q("terminal-footer") === null && q("terminal-pop-out") === null, "the screen left the column");
				assert.ok(q("activity-list") !== null, "Activity is the body");
				assert.ok(q("follow-start") !== null || q("follow-stop") !== null, "Follow stays");
				assert.equal(text("teacher-panel-put-back"), "Put back");
				assert.ok(q("teacher-panel-activity") === null, "no Activity key: it is the body");
				await click("teacher-panel-put-back");
				assert.ok(shell.calls.includes("window close"));
				assert.ok(q("terminal-footer") === null, "the shell's report brings it back, not the key");
				await act(async () => shell.windowOpen(false, true));
				await settle();
				assert.ok(q("terminal-footer") !== null, "the screen shows in the column again");
				assert.ok(attaches(shell) > before, "and attaches again, so its output comes here");
			});
		} finally {
			shell.remove();
		}
	});

	it("put back from the terminal window opens the column on the screen", async () => {
		const shell = fakeShell([teacher()], true);
		try {
			await mounted(ON, async () => {
				await act(async () => shell.windowOpen(true));
				assert.ok(q("teacher-panel") === null);
				await act(async () => shell.windowOpen(false, true));
				await settle();
				assert.ok(q("terminal-footer") !== null);
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

	it("a question brings no panel while it is open; the status lights and a click there brings the window forward", async () => {
		const shell = fakeShell([teacher()], true);
		try {
			await mounted(ON, async () => {
				await act(async () => shell.windowOpen(true));
				await act(async () => shell.push({ id: "t1", ended: null, prompt: "menu", url: false }));
				await settle();
				assert.ok(q("teacher-panel") === null, "the panel stays shut");
				await click("status");
				assert.ok(shell.calls.includes("window focus"));
				assert.ok(q("teacher-panel") === null, "and opens no column");
				await act(async () => shell.windowOpen(false));
				await settle();
				assert.ok(q("teacher-panel") === null, "a question that came meanwhile does not open it on the way back");
			});
		} finally {
			shell.remove();
		}
	});

	it("every key that shows the terminal brings the window forward instead, even with the column open", async () => {
		const shell = fakeShell([teacher()], true);
		try {
			await mounted(
				ON,
				async () => {
					await act(async () => shell.windowOpen(true));
					await click("open-terminal");
					assert.equal(shell.calls.filter((c) => c === "window focus").length, 1);
					await click("open-panel");
					await click("open-terminal");
					assert.equal(shell.calls.filter((c) => c === "window focus").length, 2);
					assert.ok(q("terminal-footer") === null);
				},
			);
		} finally {
			shell.remove();
		}
	});

	it("is a page with the status line, Put back, the screen and its bottom row, and no other panel key", async () => {
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
								<TerminalWindow />
							</TerminalsProvider>
						</ServerEventsProvider>
					</MemoryRouter>,
				),
			);
			for (let i = 0; i < 10 && !q("terminal-footer"); i++) await settle();
			assert.ok(q("terminal-window") !== null && q("teacher-panel-agent") !== null);
			assert.ok(q("terminal-footer") !== null, "the screen with its row");
			assert.ok(shell.calls.includes("attach t1"), "it attaches itself");
			for (const gone of ["terminal-pop-out", "teacher-panel-activity", "teacher-panel-chats", "follow-start", "follow-stop"]) assert.equal(q(gone), null, gone);
			await click("teacher-panel-put-back");
			assert.deepEqual(shell.calls.filter((c) => c.startsWith("window")), ["window close"], "it only closes: the column is the main window's");
			assert.equal(shell.calls.filter((c) => c.startsWith("start")).length, 0, "and starts nothing by itself");
		} finally {
			await act(async () => root.unmount());
			await settle();
			host.remove();
			shell.remove();
		}
	});
});
