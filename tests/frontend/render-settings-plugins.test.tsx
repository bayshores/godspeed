/**
 * Settings → Plugins in a DOM: the list and the picked plugin's sheet from real server answers,
 * the switch and settings that save, a plugin that failed to load, a failed install, the Add
 * sheet over godspeed's list and Update.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";

const dom = parseHTML("<!doctype html><html><body></body></html>");
// linkedom's document has no "oninput"; without it React would watch text fields an old-IE way.
(dom.document as unknown as { oninput: null }).oninput = null;
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	HTMLInputElement: dom.window.HTMLInputElement,
	Node: dom.window.Node,
	CustomEvent: dom.window.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
});

const { createRoot } = await import("react-dom/client");
const { PluginsSection } = await import("../../src/frontend/components/settings/plugins-section.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { AgentStatusProvider } = await import("../../src/frontend/components/agent-status.tsx");
import type { InstalledPlugin, ListedPlugin } from "../../src/frontend/lib/plugins-api.ts";

const quietEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });
const originalFetch = globalThis.fetch;
let root: Root | undefined;
let host: HTMLElement | undefined;

const MEMES: InstalledPlugin = {
	id: "memes",
	folder: "/home/godspeed/plugins/memes",
	enabled: true,
	values: { mode: "Answer", tone: "Deadpan", emphasis: true, days: 3 },
	manifest: {
		id: "memes",
		name: "Memes",
		version: "0.1.0",
		description: "Made from your lesson.",
		author: "808arc",
		entry: "index.html",
		lesson: { label: "Memes" },
		settings: [
			{ key: "mode", label: "Mode", kind: "choice", options: ["Answer", "Hint", "Think", "Shuffle"], default: "Answer" },
			{ key: "tone", label: "Tone", kind: "choice", options: ["Deadpan", "Absurd", "Sarcastic", "Self-deprecating", "Playful"], default: "Deadpan" },
			{ key: "emphasis", label: "Emphasis", kind: "toggle", default: true },
			{ key: "days", label: "Days before repeat", kind: "number", default: 3 },
		],
		network: ["api.memegen.link"],
		uses: ["agent"],
	},
};
const CARDS: InstalledPlugin = {
	id: "cards",
	folder: "/home/godspeed/plugins/cards",
	enabled: false,
	values: {},
	manifest: { id: "cards", name: "Flashcards", version: "0.4.1", description: "Recall cards on a schedule", author: "LearnHarness", entry: "index.html", space: { label: "Cards" }, settings: [], network: [], uses: ["space"] },
};
const { name, description, lesson, network, uses } = (MEMES as Extract<InstalledPlugin, { manifest: unknown }>).manifest;
const MEMES_ABOUT = { name, description, lesson, network, uses };
const QUIZ: ListedPlugin = { id: "quiz", repo: "ann/quiz", tag: "v1.0.0", name: "Quiz", description: "Five quick questions", space: { label: "Quiz" }, network: [], uses: ["space"] };
const BROKEN: InstalledPlugin = { id: "old-quiz", folder: "/home/godspeed/plugins/old-quiz", error: "manifest.json: version must be like 1.0.0" };

interface Call {
	method: string;
	url: string;
	body: unknown;
}

/** The plugins routes over made-up plugins; `install` answers a POST, `listed` is godspeed's list. */
function serve(initial: InstalledPlugin[], install?: (body: unknown) => Response | Promise<Response>, listed: ListedPlugin[] = []) {
	let plugins = initial;
	const calls: Call[] = [];
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		const method = init?.method ?? "GET";
		const body = init?.body ? JSON.parse(String(init.body)) : undefined;
		calls.push({ method, url: String(url), body });
		const id = String(url).split("/")[3];
		if (String(url).startsWith("/api/mcp-access")) return Response.json({ agentConnected: true, agentName: "Claude" });
		if (String(url) === "/api/plugin-list") return Response.json({ plugins: listed });
		if (method === "POST") return install!(body);
		if (method === "DELETE") {
			plugins = plugins.filter((p) => p.id !== id);
			return Response.json({ ok: true });
		}
		if (method === "PUT") {
			const old = plugins.find((p) => p.id === id) as Extract<InstalledPlugin, { manifest: unknown }>;
			const next = { ...old, enabled: body.enabled ?? old.enabled, values: { ...old.values, ...body.values } };
			plugins = plugins.map((p) => (p.id === id ? next : p));
			return Response.json({ plugin: next });
		}
		return Response.json({ plugins });
	}) as typeof fetch;
	return { calls, set: (next: InstalledPlugin[]) => (plugins = next) };
}

async function mount() {
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () =>
		root!.render(
			<ServerEventsProvider connect={quietEvents as never}>
				<AgentStatusProvider>
					<PluginsSection />
				</AgentStatusProvider>
			</ServerEventsProvider>,
		),
	);
	await act(async () => {
		await new Promise((r) => setTimeout(r, 10));
	});
}
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (id: string) => act(async () => q(id)!.click());

afterEach(async () => {
	await act(async () => root?.unmount());
	host?.remove();
	root = undefined;
	host = undefined;
	globalThis.fetch = originalFetch;
	delete (window as { lh?: unknown }).lh;
});

describe("Settings, Plugins", () => {
	it("no plugins: the list holds only Add and the right side says so", async () => {
		serve([]);
		(window as { lh?: unknown }).lh = { pickFolder: async () => null };
		await mount();
		assert.equal(q("plugins-list")!.textContent, "Add");
		assert.equal(q("plugins-empty")!.textContent, "No plugins yet.");
		assert.ok(q("plugin-sheet") === null);
	});

	it("the first plugin's sheet: name, one line, a row per setting, then who made it", async () => {
		serve([MEMES, CARDS]);
		(window as { lh?: unknown }).lh = { pickFolder: async () => null, openPath: async () => {} };
		await mount();
		assert.equal(q("plugin-memes")!.getAttribute("aria-current"), "true");
		assert.ok(q("plugin-memes")!.className.includes("bg-highlight"));
		assert.equal(q("plugin-cards")!.textContent, "FlashcardsOff");
		const sheet = q("plugin-sheet")!;
		assert.equal(sheet.querySelector("h2")!.textContent, "Memes");
		assert.equal(sheet.querySelector("p")!.textContent, "Made from your lesson. Uses Teacher and api.memegen.link.");
		assert.equal(q("toggle-memes")!.getAttribute("aria-checked"), "true");
		// Four options sit side by side, five open as a list.
		assert.equal(q("plugin-setting-mode-Hint")!.getAttribute("role"), "radio");
		assert.equal(q("plugin-setting-tone")!.tagName, "SELECT");
		assert.equal((q("plugin-setting-tone") as unknown as HTMLSelectElement).value, "Deadpan");
		assert.equal(q("toggle-emphasis")!.getAttribute("aria-checked"), "true");
		assert.equal((q("plugin-setting-days") as unknown as HTMLInputElement).value, "3");
		assert.ok(sheet.textContent!.includes("0.1.0 by 808arc"));
		assert.equal(q("plugin-show-folder")!.textContent, "Show folder");
		assert.equal(q("plugin-remove")!.textContent, "Remove");
		assert.ok(q("plugin-error") === null);
	});

	it("Remove on a working plugin asks first and says its settings go", async () => {
		const server = serve([MEMES, CARDS]);
		await mount();
		await click("plugin-remove");
		assert.equal(q("plugin-remove-confirm")!.textContent, "Remove Memes?Its settings are deleted.CancelRemove");
		assert.ok(server.calls.every((c) => c.method !== "DELETE"), "the first click only asks");
		await click("plugin-remove-confirm-keep");
		assert.ok(q("plugin-remove-confirm") === null);
		await click("plugin-remove");
		await click("plugin-remove-confirm-go");
		assert.deepEqual(server.calls.at(-1), { method: "DELETE", url: "/api/plugins/memes", body: undefined });
		assert.ok(q("plugin-memes") === null);
	});

	it("the other plugin's sheet shows after a pick, its settings dimmed and locked while it is off", async () => {
		serve([MEMES, { ...CARDS, manifest: { ...CARDS.manifest!, settings: [{ key: "n", label: "Cards a day", kind: "number", default: 5 }] } } as InstalledPlugin]);
		await mount();
		await click("plugin-cards");
		assert.equal(q("plugin-sheet")!.querySelector("h2")!.textContent, "Flashcards");
		assert.equal(q("plugin-sheet")!.querySelector("p")!.textContent, "Recall cards on a schedule. Uses the space's facts.");
		assert.equal(q("toggle-flashcards")!.getAttribute("aria-checked"), "false");
		const row = q("plugin-row-n")!.parentElement!;
		assert.ok(row.hasAttribute("inert") && row.className.includes("opacity-45"));
		assert.equal(q("plugin-memes")!.textContent, "Memes", "off is said only for a plugin that isn't picked");
		assert.ok(q("plugins-add") === null, "no folder chooser outside the desktop app, so no Add");
	});

	it("the switch and a setting save to the server and show what came back", async () => {
		const server = serve([MEMES]);
		await mount();
		await click("toggle-memes");
		assert.deepEqual(server.calls.at(-1), { method: "PUT", url: "/api/plugins/memes", body: { enabled: false } });
		assert.equal(q("toggle-memes")!.getAttribute("aria-checked"), "false");
		assert.ok(q("plugin-row-mode")!.parentElement!.hasAttribute("inert"));
		await click("toggle-memes");
		await click("plugin-setting-mode-Hint");
		assert.deepEqual(server.calls.at(-1), { method: "PUT", url: "/api/plugins/memes", body: { values: { mode: "Hint" } } });
		assert.equal(q("plugin-setting-mode-Hint")!.getAttribute("aria-checked"), "true");
		await click("toggle-emphasis");
		assert.deepEqual(server.calls.at(-1)!.body, { values: { emphasis: false } });
	});

	it("a plugin that failed to load shows its folder name, why, and Remove", async () => {
		const server = serve([BROKEN, MEMES]);
		await mount();
		assert.equal(q("plugin-old-quiz")!.textContent, "old-quiz");
		assert.equal(q("plugin-sheet")!.querySelector("h2")!.textContent, "old-quiz");
		assert.equal(q("plugin-broken")!.textContent, "manifest.json: version must be like 1.0.0");
		assert.ok(q("toggle-old-quiz") === null);
		assert.ok(q("plugin-show-folder") === null);
		await click("plugin-remove");
		assert.equal(q("plugin-remove-confirm")!.textContent, "Remove old-quiz?CancelRemove");
		assert.ok(server.calls.every((c) => c.method !== "DELETE"), "the first click only asks");
		await click("plugin-remove-confirm-keep");
		assert.ok(q("plugin-remove-confirm") === null && q("plugin-remove"));
		await click("plugin-remove");
		await click("plugin-remove-confirm-go");
		assert.deepEqual(server.calls.at(-1), { method: "DELETE", url: "/api/plugins/old-quiz", body: undefined });
		assert.ok(q("plugin-old-quiz") === null);
		assert.equal(q("plugin-sheet")!.querySelector("h2")!.textContent, "Memes");
	});

	it("Add opens the folder chooser itself; a failed install says why beside Add", async () => {
		const server = serve([MEMES], () => Response.json({ error: "The folder has no manifest.json." }, { status: 400 }));
		let asked = 0;
		(window as { lh?: unknown }).lh = {
			pickFolder: async () => {
				asked++;
				return "/Users/me/plugin";
			},
		};
		await mount();
		await click("plugins-add");
		assert.equal(asked, 1);
		assert.deepEqual(server.calls.find((c) => c.method === "POST"), { method: "POST", url: "/api/plugins", body: { from: "folder", folder: "/Users/me/plugin" } });
		assert.equal(q("plugins-add-error")!.textContent, "The folder has no manifest.json.");
		await click("plugin-memes");
		assert.ok(q("plugins-add-error") === null, "picking a plugin clears it");
	});

	it("an install that works lists the new plugin and opens its sheet; a cancelled chooser does nothing", async () => {
		const server = serve([MEMES], () => {
			server.set([MEMES, CARDS]);
			return Response.json({ plugin: CARDS });
		});
		let folder: string | null = null;
		(window as { lh?: unknown }).lh = { pickFolder: async () => folder };
		await mount();
		await click("plugins-add");
		assert.ok(server.calls.every((c) => c.method !== "POST"));
		folder = "/Users/me/cards";
		await click("plugins-add");
		assert.equal(q("plugin-cards")!.getAttribute("aria-current"), "true");
		assert.equal(q("plugin-sheet")!.querySelector("h2")!.textContent, "Flashcards");
	});

	it("a failed save says why in the sheet", async () => {
		serve([MEMES]);
		const real = globalThis.fetch;
		globalThis.fetch = (async (url: string, init?: RequestInit) => (init?.method === "PUT" ? Response.json({ error: "Mode must be one of the options." }, { status: 400 }) : real(url, init))) as typeof fetch;
		await mount();
		await click("plugin-setting-mode-Think");
		assert.equal(q("plugin-error")!.textContent, "Mode must be one of the options.");
	});

	it("with plugins on the list to add, Add shows the Add sheet: the line, a row each, then the folder", async () => {
		serve([MEMES], undefined, [{ ...QUIZ }, { id: "memes", repo: "808arc/meme-plugin", tag: "v0.2.0", ...MEMES_ABOUT }]);
		(window as { lh?: unknown }).lh = { pickFolder: async () => null };
		await mount();
		await click("plugins-add");
		assert.equal(q("plugins-add")!.getAttribute("aria-current"), "true");
		assert.equal(q("plugin-memes")!.getAttribute("aria-current"), "false");
		const sheet = q("plugins-add-sheet")!;
		assert.ok(q("plugin-sheet") === null);
		assert.equal(sheet.querySelector("p")!.textContent, "Checked by godspeed.");
		assert.equal(q("plugins-listed-quiz")!.textContent, "QuizFive quick questions. Uses the space's facts.Add");
		assert.ok(q("plugins-listed-memes") === null, "an installed plugin isn't offered again");
		assert.equal(q("plugins-from-folder")!.textContent, "From a folderChoose");
		assert.equal(sheet.textContent, "Checked by godspeed.QuizFive quick questions. Uses the space's facts.AddFrom a folderChoose");
	});

	it("a listed add sends only its id, reads Adding… while it runs, then opens the new plugin's sheet", async () => {
		let finish: (r: Response) => void = () => {};
		const added: InstalledPlugin = { id: "quiz", folder: "/p/quiz", enabled: true, values: {}, source: { repo: "ann/quiz", tag: "v1.0.0" }, manifest: { ...QUIZ, version: "1.0.0", author: "ann", entry: "index.html", settings: [] } };
		const server = serve([MEMES], () => new Promise((done) => (finish = done)), [QUIZ]);
		await mount();
		await click("plugins-add");
		await click("plugins-listed-add-quiz");
		assert.deepEqual(server.calls.find((c) => c.method === "POST")!.body, { from: "list", id: "quiz" });
		assert.equal(q("plugins-listed-add-quiz")!.textContent, "Adding…");
		assert.ok(q("plugins-listed-add-quiz")!.hasAttribute("disabled"));
		server.set([MEMES, added]);
		await act(async () => finish(Response.json({ plugin: added })));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});
		assert.ok(q("plugins-add-sheet") === null);
		assert.equal(q("plugin-quiz")!.getAttribute("aria-current"), "true");
		assert.ok(q("plugins-add") === null, "nothing left to add and no folder chooser here, so no Add");
	});

	it("a failed listed add says so under its row and only then", async () => {
		serve([], () => Response.json({ error: "This tag of the plugin isn't what godspeed's list checked." }, { status: 400 }), [QUIZ]);
		await mount();
		await click("plugins-add");
		assert.ok(q("plugin-error") === null);
		assert.ok(q("plugins-from-folder") === null, "no folder chooser outside the desktop app");
		await click("plugins-listed-add-quiz");
		assert.equal(q("plugin-error")!.textContent, "Quiz couldn't be added.");
		assert.equal(q("plugins-listed-add-quiz")!.textContent, "Add");
	});

	it("with nothing on the list to add, Add opens the folder chooser itself", async () => {
		serve([MEMES], undefined, [{ id: "memes", repo: "808arc/meme-plugin", tag: "v0.2.0", ...MEMES_ABOUT }]);
		let asked = 0;
		(window as { lh?: unknown }).lh = { pickFolder: async () => (asked++, null) };
		await mount();
		await click("plugins-add");
		assert.equal(asked, 1);
		assert.ok(q("plugins-add-sheet") === null);
	});

	it("a plugin from the list whose listed tag moved shows Update left of Remove; a failure says so", async () => {
		const fromList = { ...MEMES, source: { repo: "808arc/meme-plugin", tag: "v0.1.0" } } as InstalledPlugin;
		let finish: (r: Response) => void = () => {};
		const server = serve([fromList], () => new Promise((done) => (finish = done)), [{ id: "memes", repo: "808arc/meme-plugin", tag: "v0.2.0", ...MEMES_ABOUT }]);
		(window as { lh?: unknown }).lh = { openPath: async () => {} };
		await mount();
		const keys = [...q("plugin-sheet")!.querySelectorAll("button")].slice(-3).map((b) => b.textContent);
		assert.deepEqual(keys, ["Show folder", "Update", "Remove"]);
		await click("plugin-update");
		assert.deepEqual(server.calls.find((c) => c.method === "POST")!.body, { from: "list", id: "memes" });
		assert.equal(q("plugin-update")!.textContent, "Updating…");
		assert.ok(q("plugin-update")!.hasAttribute("disabled") && q("plugin-remove")!.hasAttribute("disabled"));
		await act(async () => finish(Response.json({ error: "Couldn't download the plugin: fetch failed" }, { status: 502 })));
		assert.equal(q("plugin-error")!.textContent, "Memes couldn't be updated.");
	});

	it("no Update for the listed tag already installed, nor for a plugin added from a folder", async () => {
		const listed = [{ id: "memes", repo: "808arc/meme-plugin", tag: "v0.2.0", ...MEMES_ABOUT }];
		serve([{ ...MEMES, source: { repo: "808arc/meme-plugin", tag: "v0.2.0" } } as InstalledPlugin], undefined, listed);
		await mount();
		assert.ok(q("plugin-sheet") && q("plugin-update") === null);
		await act(async () => root?.unmount());
		serve([MEMES], undefined, listed);
		await mount();
		assert.ok(q("plugin-sheet") && q("plugin-update") === null);
	});
});
