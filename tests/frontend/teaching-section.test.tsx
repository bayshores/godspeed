import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { it } from "node:test";
import { parseHTML } from "linkedom";
import type { AgentSettings } from "../../src/shared/core/index.ts";

/** Mounts the section over a fake DOM whose fetch answers from `respond`;
 *  `run` gets the window, and the globals come back after. */
async function withSection(
	respond: (url: string) => Response,
	onSectionChange: (next: AgentSettings) => void,
	run: (win: Window & typeof globalThis) => Promise<void>,
	onFullPage: (open: boolean) => void = () => {},
) {
	const dom = parseHTML("<html><body><div id='root'></div></body></html>");
	// linkedom's document has no "oninput"; without it React would watch text
	// fields an old-IE way.
	(dom.document as unknown as { oninput: null }).oninput = null;
	const globals = globalThis as Record<string, unknown>;
	const previous = new Map<string, PropertyDescriptor | undefined>();
	for (const [key, value] of Object.entries({
		window: dom.window,
		document: dom.document,
		navigator: globals.navigator ?? { userAgent: "", platform: "" },
		HTMLElement: dom.window.HTMLElement,
		IS_REACT_ACT_ENVIRONMENT: true,
		fetch: async (url: string) => respond(url),
	})) {
		previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	}
	// react-dom checks the DOM when it loads, so it (and the section, which
	// pulls it in) load only after the fake DOM is in place.
	const { createRoot } = await import("react-dom/client");
	const { TeachingSection } = await import("../../src/frontend/components/settings/teaching-section.tsx");
	const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
	const quietEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });
	const root = createRoot(document.getElementById("root")!);
	try {
		await act(async () => {
			root.render(
				<ServerEventsProvider connect={quietEvents as never}>
					<TeachingSection
						agent={{ tools: { research: true }, rules: { voice: ["No jokes"] } }}
						graph={undefined}
						onGraphChange={(next) => graphWrites.push(next)}
						teacherName="Ada"
						onSectionChange={onSectionChange}
						onFullPage={onFullPage}
					/>
				</ServerEventsProvider>,
			);
		});
		await run(dom.window as unknown as Window & typeof globalThis);
	} finally {
		act(() => root.unmount());
		for (const [key, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globals[key];
		}
	}
}

/** What the graph switch wrote, in order. */
const graphWrites: unknown[] = [];

const RULES = { rules: [{ where: { area: "voice" }, text: "No jokes", at: "2026-10-30T12:00:00.000Z" }] };

it("Teaching: the research switch and a new rule each write the whole agent section", async () => {
	const bodies: Record<string, unknown> = { "/api/settings/prompts": { segments: [] }, "/api/rules": RULES, "/api/web-search": { keyEnd: null, used: null, limit: null, error: null } };
	const respond = (url: string) => {
		assert.ok(url in bodies, `unexpected request: ${url}`);
		return new Response(JSON.stringify(bodies[url]));
	};
	let written: AgentSettings | undefined;
	await withSection(respond, (next) => (written = next), async (win) => {
		assert.match(document.querySelector('[data-testid="rules-voice"]')!.textContent!, /No jokesSaved by Ada/, "the agent's rule is labeled");
		await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="area-facts"]')!.click());
		const toggle = document.querySelector<HTMLButtonElement>('[data-testid="toggle-web-search"]')!;
		assert.equal(toggle.hasAttribute("disabled"), false);
		assert.equal(toggle.getAttribute("aria-checked"), "true");
		await act(async () => toggle.click());
		assert.deepEqual(written, { tools: { research: false }, rules: { voice: ["No jokes"] } });

		const input = document.querySelector<HTMLInputElement>('[data-testid="rules-facts-input"]')!;
		assert.ok(input, "the Add a rule field is always there");
		await act(async () => {
			Object.defineProperty(input, "value", { configurable: true, writable: true, value: "Cite the textbook" });
			input.dispatchEvent(new win.Event("input", { bubbles: true }));
		});
		const enter = new win.Event("keydown", { bubbles: true, cancelable: true });
		Object.defineProperty(enter, "key", { value: "Enter" });
		await act(async () => input.dispatchEvent(enter));
		assert.deepEqual(written?.rules, { voice: ["No jokes"], facts: ["Cite the textbook"] });
		assert.equal(written?.tools?.research, true, "the rest of the section carries over");

		// The graph switch writes the graph section alone, with nothing an older version kept there.
		graphWrites.length = 0;
		await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="toggle-build-the-graph-from-lessons"]')!.click());
		assert.deepEqual(graphWrites, [{ enabled: false }]);
	});
});

it("Teaching: instructions that fail to load say so, and Try again reads them again", async () => {
	let promptsOk = false;
	const respond = (url: string) => {
		if (url === "/api/rules") return new Response(JSON.stringify(RULES));
		assert.equal(url, "/api/settings/prompts");
		return promptsOk ? new Response(JSON.stringify({ segments: [] })) : new Response("{}", { status: 500 });
	};
	await withSection(respond, () => {}, async () => {
		const failed = document.querySelector('[data-testid="load-failed"]');
		assert.ok(failed, "the failure is shown");
		assert.match(failed.textContent!, /Couldn't load the instructions\./);
		assert.equal(document.querySelector('[data-testid="area-voice-instructions"]')!.hasAttribute("disabled"), true);
		promptsOk = true;
		await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="load-failed-retry"]')!.click());
		assert.ok(document.querySelector('[data-testid="load-failed"]') === null, "the retry's answer clears it");
		assert.equal(document.querySelector('[data-testid="area-voice-instructions"]')!.hasAttribute("disabled"), false);
	});
});

const PART = { path: "shared/10-voice.md", sourceText: "Be plain.", overrideText: null, shared: true };

it("Teaching: Edit full instructions fills the page, and Teaching brings the areas back", async () => {
	const respond = (url: string) => new Response(JSON.stringify(url === "/api/settings/prompts" ? { segments: [PART] } : RULES));
	const fullPage: boolean[] = [];
	await withSection(respond, () => {}, async () => {
		await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="area-voice-instructions"]')!.click());
		const panel = document.querySelector('[data-testid="instructions-panel"]')!;
		assert.ok(panel, "the instructions open");
		assert.match(panel.textContent!, /Voice, full instructions/);
		assert.match(panel.textContent!, /What Ada reads before every lesson/);
		assert.ok(document.querySelector('[data-testid="area-voice"]') === null, "the areas list is gone");
		assert.equal(fullPage.at(-1), true, "the page is told to hide its heading");
		await act(async () => panel.querySelector<HTMLButtonElement>("button")!.click());
		assert.ok(document.querySelector('[data-testid="instructions-panel"]') === null);
		assert.ok(document.querySelector('[data-testid="area-voice"]'), "back on the areas");
		assert.equal(fullPage.at(-1), false);
	}, (open) => fullPage.push(open));
});

it("Teaching: Remembered is the last entry of the list and shows the agent's notes", async () => {
	const notes = [{ id: "n1", text: "Likes proofs.", spaceName: "CSE 21", createdAt: "2026-10-30T12:00:00.000Z" }];
	const respond = (url: string) => new Response(JSON.stringify(url === "/api/settings/prompts" ? { segments: [] } : url === "/api/rules" ? RULES : { notes }));
	await withSection(respond, () => {}, async () => {
		const ids = [...document.querySelectorAll("[aria-label='Teaching areas'] button")].map((el) => el.getAttribute("data-testid"));
		assert.equal(ids.at(-1), "area-remembered");
		await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="area-remembered"]')!.click());
		assert.match(document.querySelector('[data-testid="remembered-notes"]')!.textContent!, /Likes proofs\.CSE 21, saved/);
	});
});
