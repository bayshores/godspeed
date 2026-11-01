import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { it } from "node:test";
import { parseHTML } from "linkedom";
import type { AgentSettings } from "../src/core/index.ts";

/** Mounts the section over a fake DOM whose fetch answers from `respond`;
 *  `run` gets the window, and the globals come back after. */
async function withSection(
	respond: (url: string) => Response,
	onSectionChange: (next: AgentSettings) => void,
	run: (win: Window & typeof globalThis) => Promise<void>,
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
	const { TeachingSection } = await import("../src/components/settings/teaching-section.tsx");
	const { ServerEventsProvider } = await import("../src/components/server-events.tsx");
	const quietEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });
	const root = createRoot(document.getElementById("root")!);
	try {
		await act(async () => {
			root.render(
				<ServerEventsProvider connect={quietEvents as never}>
					<TeachingSection
						agent={{ tools: { research: true }, rules: { voice: ["No jokes"] } }}
						graph={undefined}
						teacherName="Halley"
						onSectionChange={onSectionChange}
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

const RULES = { rules: [{ where: { area: "voice" }, text: "No jokes", at: "2026-10-30T12:00:00.000Z" }] };

it("Teaching: the research switch and a new rule each write the whole agent section", async () => {
	const bodies: Record<string, unknown> = { "/api/settings/prompts": { segments: [] }, "/api/rules": RULES };
	const respond = (url: string) => {
		assert.ok(url in bodies, `unexpected request: ${url}`);
		return new Response(JSON.stringify(bodies[url]));
	};
	let written: AgentSettings | undefined;
	await withSection(respond, (next) => (written = next), async (win) => {
		assert.match(document.querySelector('[data-testid="rules-voice"]')!.textContent!, /No jokesSaved by Halley/, "the agent's rule is labeled");
		const toggle = document.querySelector<HTMLButtonElement>('[data-testid="toggle-web-research"]')!;
		assert.equal(toggle.hasAttribute("disabled"), false);
		assert.equal(toggle.getAttribute("aria-checked"), "true");
		await act(async () => toggle.click());
		assert.deepEqual(written, { tools: { research: false }, rules: { voice: ["No jokes"] } });

		await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="rules-facts-add"]')!.click());
		const input = document.querySelector<HTMLInputElement>('[data-testid="rules-facts-input"]')!;
		assert.ok(input, "Add a rule opens an input");
		await act(async () => {
			Object.defineProperty(input, "value", { configurable: true, writable: true, value: "Cite the textbook" });
			input.dispatchEvent(new win.Event("input", { bubbles: true }));
		});
		const enter = new win.Event("keydown", { bubbles: true, cancelable: true });
		Object.defineProperty(enter, "key", { value: "Enter" });
		await act(async () => input.dispatchEvent(enter));
		assert.deepEqual(written?.rules, { voice: ["No jokes"], facts: ["Cite the textbook"] });
		assert.equal(written?.tools?.research, true, "the rest of the section carries over");
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
		assert.equal(document.querySelector('[data-testid="load-failed"]'), null, "the retry's answer clears it");
		assert.equal(document.querySelector('[data-testid="area-voice-instructions"]')!.hasAttribute("disabled"), false);
	});
});
