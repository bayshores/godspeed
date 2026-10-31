/**
 * First-launch onboarding (owner, 2026-10-27): who sees it
 * (server/onboarding.ts, decided once from data/mcp-token and stored as
 * general.onboarded), the settings field, the screens' pure helpers, the
 * constellation's markup, and the class picker following the server's
 * active class after onboarding finishes (router.refresh()).
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lh-onboarding-"));
const dataDir = path.join(scratch, "data");
const originalDataDir = process.env.LH_DATA_DIR;
process.env.LH_DATA_DIR = dataDir;
after(() => {
	if (originalDataDir === undefined) delete process.env.LH_DATA_DIR;
	else process.env.LH_DATA_DIR = originalDataDir;
	fs.rmSync(scratch, { recursive: true, force: true });
});

const dom = parseHTML("<!doctype html><html><body></body></html>");
(dom.document as unknown as { oninput: null }).oninput = null;
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	CustomEvent: dom.window.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
});

const { onboardingNeeded } = await import("../src/server/onboarding.ts");
const { readSettings, writeSettings } = await import("../src/store/settings.ts");
const { readMcpToken, writeNewMcpToken } = await import("../src/store/mcp-token.ts");
const { sanitizeUserSettings } = await import("../src/core/settings.ts");
const { parseGeneralSettingsBody } = await import("../src/server/settings-body.ts");
const { agentLine, pickedLabel, DoneStep } = await import("../src/components/onboarding/onboarding.tsx");
const { Constellation, DOTS, LINKS, dotDelay } = await import("../src/components/onboarding/constellation.tsx");
const { createRoot } = await import("react-dom/client");
const { ServerEventsProvider } = await import("../src/components/server-events.tsx");
const { ClassProvider, useClasses } = await import("../src/components/class-context.tsx");

describe("onboardingNeeded (who sees the first-launch onboarding)", () => {
	beforeEach(() => fs.rmSync(dataDir, { recursive: true, force: true }));

	it("a new install (no token): shows it, stores onboarded:false, makes the token", () => {
		assert.equal(onboardingNeeded(), true);
		assert.equal(readSettings()?.general?.onboarded, false);
		assert.ok(readMcpToken());
		// Reloading mid-onboarding keeps showing it.
		assert.equal(onboardingNeeded(), true);
	});

	it("an existing user (token from before): skips it and stores onboarded:true", () => {
		const token = writeNewMcpToken();
		writeSettings({ version: 1, general: { activeClass: "cls_x" } });
		assert.equal(onboardingNeeded(), false);
		const general = readSettings()?.general;
		assert.equal(general?.onboarded, true);
		assert.equal(general?.activeClass, "cls_x", "other general fields are kept");
		assert.equal(readMcpToken(), token, "the old token is kept");
	});

	it("a stored answer wins over the token check", () => {
		writeSettings({ version: 1, general: { onboarded: true } });
		assert.equal(onboardingNeeded(), false);
		assert.ok(readMcpToken(), "the token is made either way");
		writeSettings({ version: 1, general: { onboarded: false } });
		assert.equal(onboardingNeeded(), true);
	});
});

describe("the onboarded setting", () => {
	it("the sanitizer keeps a boolean and drops anything else", () => {
		assert.equal(sanitizeUserSettings({ general: { onboarded: true } })?.general?.onboarded, true);
		assert.equal(sanitizeUserSettings({ general: { onboarded: false } })?.general?.onboarded, false);
		assert.equal(sanitizeUserSettings({ general: { onboarded: "yes" } })?.general?.onboarded, undefined);
	});
	it("PUT /api/settings/general accepts a boolean only", () => {
		const ok = parseGeneralSettingsBody({ onboarded: true, activeClass: "cls_a" });
		assert.ok(ok.ok);
		assert.equal(ok.settings.onboarded, true);
		assert.equal(parseGeneralSettingsBody({ onboarded: 1 }).ok, false);
	});
});

describe("onboarding screen helpers", () => {
	it("agentLine: waiting per tab, then the agent's name", () => {
		assert.equal(agentLine("claude", false), "Waiting for Claude Code…");
		assert.equal(agentLine("codex", false), "Waiting for Codex…");
		assert.equal(agentLine("other", false), "Waiting for your app…");
		assert.equal(agentLine("claude", true, "Claude Code"), "Claude Code connected");
		assert.equal(agentLine("other", true), "Your agent connected");
	});
	it("pickedLabel: a folder path or up to three file names", () => {
		assert.equal(pickedLabel(null), null);
		assert.equal(pickedLabel({ kind: "folder", path: "/u/notes" }), "Folder: /u/notes");
		const files = ["a.pdf", "b.md", "c.txt", "d.pdf"].map((name) => ({ name }) as File);
		assert.equal(pickedLabel({ kind: "files", files: files.slice(0, 1) }), "1 file: a.pdf");
		assert.equal(pickedLabel({ kind: "files", files }), "4 files: a.pdf, b.md, c.txt, …");
	});
	it("the done step without an agent: teaching waits for one, and a button goes back to step 1", () => {
		const done = (over: Partial<React.ComponentProps<typeof DoneStep>> = {}) =>
			renderToStaticMarkup(<DoneStep agent={null} onStart={() => {}} onConnect={() => {}} disabled={false} failed={false} {...over} />);
		const none = done();
		assert.ok(none.includes("Teaching starts once an agent is connected."));
		assert.ok(none.includes('data-testid="onboarding-connect"'));
		assert.ok(none.includes("Connect your agent"));
		assert.ok(!none.includes("You’re all set."));
		const set = done({ agent: { name: "Codex" } });
		assert.ok(set.includes("You’re all set."));
		assert.ok(set.includes("Ask Codex to teach you anything"));
		assert.ok(!set.includes("onboarding-connect"));
	});
	it("the done step after a failed save: an error and Try again", () => {
		const html = renderToStaticMarkup(<DoneStep agent={{}} onStart={() => {}} onConnect={() => {}} disabled={false} failed />);
		assert.ok(html.includes('data-testid="onboarding-save-error"'));
		assert.match(html, /data-testid="onboarding-finish"[^>]*>Try again</);
	});
	it("dotDelay: dots appear as the comet passes, left to right", () => {
		const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
		near(dotDelay(130), 0.6);
		near(dotDelay(740), 1.3);
		near(dotDelay(1300), 1.7);
		assert.ok(dotDelay(400) < dotDelay(600));
	});
	it("the constellation draws every dot and link, tagged with its mode", () => {
		const html = renderToStaticMarkup(<Constellation mode="intro" />);
		assert.ok(html.includes('data-mode="intro"'));
		assert.equal(html.match(/class="ob-dot"/g)?.length, DOTS.length);
		assert.equal(html.match(/class="ob-link"/g)?.length, LINKS.length);
		assert.ok(html.includes('aria-hidden="true"'));
	});
});

describe("the class picker after onboarding", () => {
	it("follows the server's active class when the page refreshes", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ classes: [{ id: "cls_new", name: "CSE 29" }] }), { status: 200 })) as typeof fetch;
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		const connect = () => ({ onEvent() {}, onOpen() {}, close() {} });
		function Probe() {
			const { active } = useClasses();
			return <span data-testid="active">{active ?? "none"}</span>;
		}
		const tree = (initialActive: string | null) => (
			<ServerEventsProvider connect={connect as never}>
				<ClassProvider initialActive={initialActive}>
					<Probe />
				</ClassProvider>
			</ServerEventsProvider>
		);
		try {
			await act(async () => root.render(tree(null)));
			assert.equal(host.textContent, "none");
			await act(async () => root.render(tree("cls_new")));
			await act(async () => {
				await new Promise((r) => setTimeout(r, 20));
			});
			assert.equal(host.textContent, "cls_new");
		} finally {
			await act(async () => root.unmount());
			globalThis.fetch = originalFetch;
		}
	});
});
