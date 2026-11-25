/**
 * The setup card in a DOM: Settings › Teacher holds it with the teacher's name, the folder and the
 * start command; its keys ask the server to sign in, send the code, cancel and update, and the
 * card follows the server's events; a pick of the agent goes to the server; the compact card
 * stands in a job's failure line only while the panel is shut.
 */
import { dom } from "../terminal-dom.ts";
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

Object.assign(globalThis, { HTMLInputElement: dom.window.HTMLInputElement, Node: dom.window.Node, CustomEvent: dom.window.CustomEvent });
// Before React DOM loads: without "oninput" it would watch text fields an old-IE way.
(dom.document as unknown as { oninput: null }).oninput = null;

const { createRoot } = await import("react-dom/client");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { SettingsProvider } = await import("../../src/frontend/components/settings-context.tsx");
const { UpdateStateProvider } = await import("../../src/frontend/components/settings/update-settings.tsx");
const { SettingsPage } = await import("../../src/frontend/components/settings/settings-page.tsx");
const { AgentFolderProvider } = await import("../../src/frontend/components/agent-folder/agent-folder-context.tsx");
const { AgentSetupProvider } = await import("../../src/frontend/components/agent-setup/agent-setup-context.tsx");
const { JobFailure } = await import("../../src/frontend/components/agent-setup/agent-card.tsx");
const { TeacherContext } = await import("../../src/frontend/components/teacher/teacher-context.ts");
type TeacherApi = NonNullable<React.ContextType<typeof TeacherContext>>;

const FOLDER = {
	folder: "/home/ada/godspeed",
	short: "~/godspeed",
	exists: true,
	commands: { claude: "claude", codex: "codex" },
	startCommands: {},
	oldSetup: { plugin: false, codex: false },
	agent: "claude",
	model: {},
};
const passed = (check: string, fact: string | null = null) => ({ check, state: "passed", fact, problem: null, reason: null, needs: null, link: null });
const SIGNED_OUT = {
	agent: "claude",
	checking: false,
	ownCommand: false,
	checks: [passed("installed", "2.1.340"), passed("node", "22.1.0"), passed("upToDate"), { ...passed("loggedIn"), state: "failed", problem: "signedOut" }],
	failing: { check: "loggedIn", problem: "signedOut", reason: null, needs: null, link: null },
	login: null,
	update: null,
};
const READY = { ...SIGNED_OUT, checks: [passed("installed", "2.1.340"), passed("node", "22.1.0"), passed("upToDate"), passed("loggedIn", "Max plan")], failing: null };

/** What the server answers now, and what the page sent it. */
let health: object = SIGNED_OUT;
const sent: string[] = [];
/** Fires a server event into the page. */
let fire: (name: string, data: object) => void = () => {};
const realFetch = globalThis.fetch;
beforeEach(() => {
	health = SIGNED_OUT;
	sent.length = 0;
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		const path = String(url);
		if (init?.method) sent.push(`${init.method} ${path} ${String(init.body ?? "")}`);
		if (path === "/api/agent/login") return Response.json({ url: "https://claude.ai/oauth" });
		if (path.startsWith("/api/agent/health")) return Response.json(health);
		if (path.startsWith("/api/agent/models")) return Response.json({ agent: "claude", models: [{ id: "default", name: "Default (Opus)", default: true }, { id: "sonnet", name: "Sonnet", default: false }] });
		if (path.startsWith("/api/agent-folder")) return Response.json(FOLDER);
		if (path.startsWith("/api/agent/")) return Response.json({});
		return Response.json({ settings: { version: 1 } });
	}) as unknown as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));
const q = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const text = (testid: string) => q(testid)?.textContent ?? null;
const click = (el: HTMLElement) => act(async () => el.click());
const keyNamed = (label: string) => [...document.querySelectorAll<HTMLElement>('[data-testid="agent-key"]')].find((k) => k.textContent === label) ?? null;

/** Renders under the server's events (which `fire` sends), the folder and the setup, as the app does. */
async function mounted(node: React.ReactNode, run: () => Promise<void>) {
	const host = document.createElement("div");
	document.body.append(host);
	const root: Root = createRoot(host);
	const listeners = new Map<string, (data: string) => void>();
	fire = (name, data) => listeners.get(name)?.(JSON.stringify(data));
	const connect = () => ({ onEvent: (name: string, cb: (data: string) => void) => void listeners.set(name, cb), onOpen() {}, close() {} });
	try {
		await act(async () =>
			root.render(
				<ServerEventsProvider connect={connect as never}>
					<AgentFolderProvider>
						<AgentSetupProvider>{node}</AgentSetupProvider>
					</AgentFolderProvider>
				</ServerEventsProvider>,
			),
		);
		await settle();
		await run();
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
}

const settings = (
	<SettingsProvider boot={{ sounds: false, startupSound: false }}>
		<UpdateStateProvider>
			<SettingsPage section="teacher" />
		</UpdateStateProvider>
	</SettingsProvider>
);

describe("Settings › Teacher", () => {
	it("holds the card, titled Your teacher, then the name, the folder and the start command", async () => {
		await mounted(settings, async () => {
			assert.equal(q("settings-nav-teacher")?.getAttribute("aria-current"), "true");
			assert.match(text("group-teacher")!, /^Your teacher/);
			assert.equal(q("agent-card-agent-claude")?.getAttribute("aria-checked"), "true", "the picked agent is lit");
			assert.equal(text("agent-row-version-fact"), "2.1.340");
			assert.equal(q("agent-row-version")?.dataset.mark, "tick");
			assert.equal(q("agent-row-account")?.dataset.mark, "need");
			assert.ok(keyNamed("Log in")?.classList.contains("lh-btn-main"), "the first key that fixes something leads");
			assert.ok(q("agent-model") === null, "no model until both checks pass");
			assert.ok(q("teacher-name") !== null);
			assert.equal(text("agent-folder-path"), "~/godspeed");
			assert.ok(q("agent-start-command-change") !== null);
		});
	});

	it("Log in: the browser's step with the code field; Send writes the code, Cancel ends it; the checks' event ticks the row and the model shows", async () => {
		await mounted(settings, async () => {
			await click(keyNamed("Log in")!);
			assert.ok(sent.includes("POST /api/agent/login {}"), sent.join(" | "));
			health = { ...SIGNED_OUT, login: { url: "https://claude.ai/oauth", code: true } };
			await act(async () => fire("agent-health", {}));
			await settle();
			assert.equal(q("agent-row-account")?.dataset.mark, "wait");
			assert.equal(text("agent-row-account-fact"), "Finish in your browser");
			const field = q("agent-login-code")!.querySelector("input")!;
			assert.equal(field.getAttribute("placeholder"), "Code, if the page shows one");
			assert.equal(keyNamed("Open again")?.getAttribute("href"), "https://claude.ai/oauth");
			assert.ok(keyNamed("Cancel")?.classList.contains("lh-btn-quiet") && !keyNamed("Open again")?.classList.contains("lh-btn-quiet"), "Cancel is the lesser key");
			await act(async () => {
				Object.defineProperty(field, "value", { configurable: true, writable: true, value: "abc#123" });
				field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
			});
			await act(async () => q("agent-login-code")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
			assert.ok(sent.includes('POST /api/agent/login/code {"code":"abc#123"}'), sent.join(" | "));
			await click(keyNamed("Cancel")!);
			assert.ok(sent.includes("POST /api/agent/login/cancel {}"));
			health = READY;
			await act(async () => fire("agent-health", {}));
			await settle();
			assert.equal(q("agent-row-account")?.dataset.mark, "tick");
			assert.equal(text("agent-row-account-fact"), "Max plan");
			assert.equal((q("agent-model-select") as HTMLSelectElement | null)?.value, "default");
		});
	});

	it("a pick of the other agent goes to the server", async () => {
		await mounted(settings, async () => {
			await click(q("agent-card-agent-codex")!);
			assert.ok(sent.includes('PATCH /api/agent-folder {"agent":"codex"}'), sent.join(" | "));
		});
	});

	it("Update: Updating while it runs, told by its event; a failed one says so with the command to run", async () => {
		health = { ...SIGNED_OUT, checks: [passed("installed", "2.1.300"), passed("node"), { ...passed("upToDate"), state: "failed", problem: "tooOld", needs: "2.1.331" }, { ...passed("loggedIn"), state: "unchecked" }], failing: { check: "upToDate", problem: "tooOld", reason: null, needs: "2.1.331", link: null } };
		await mounted(settings, async () => {
			assert.equal(text("agent-row-version-fact"), "Too old, needs 2.1.331");
			await click(keyNamed("Update")!);
			assert.ok(sent.includes("POST /api/agent/update {}"));
			await act(async () => fire("agent-update", { state: "running", line: "Downloading", command: "claude update" }));
			assert.equal(text("agent-row-version-fact"), "Updating");
			await act(async () => fire("agent-update", { state: "failed", line: "EACCES", command: "claude update" }));
			await settle();
			assert.equal(text("agent-row-version-fact"), "Update didn't finish");
			assert.equal(q("agent-row-version-fact")?.getAttribute("title"), "EACCES");
			assert.match(text("agent-update-command")!, /^Or run this in Terminal:claude updateCopy/);
		});
	});
});

describe("the compact card", () => {
	function Failed() {
		return (
			<JobFailure>
				<p data-testid="plain-error">couldn&apos;t finish that</p>
			</JobFailure>
		);
	}
	const teacher = (panelOpen: boolean) => ({ panelOpen }) as TeacherApi;

	it("stands in a job's failure line while the agent can't run and the panel is shut, naming the agent", async () => {
		await mounted(
			<TeacherContext.Provider value={teacher(false)}>
				<Failed />
			</TeacherContext.Provider>,
			async () => {
				assert.match(text("agent-compact")!, /^Claude Code isn't logged in\.Log in/);
				health = READY;
				await act(async () => fire("agent-health", {}));
				await settle();
				assert.ok(q("agent-compact") === null && q("plain-error") !== null, "the send's own line, with its Try again, once it can run");
			},
		);
	});

	it("is not drawn while the panel is open on the full card", async () => {
		await mounted(
			<TeacherContext.Provider value={teacher(true)}>
				<Failed />
			</TeacherContext.Provider>,
			async () => {
				assert.ok(q("agent-compact") === null);
				assert.ok(q("plain-error") !== null);
			},
		);
	});
});
