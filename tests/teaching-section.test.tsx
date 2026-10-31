import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { it } from "node:test";
import { parseHTML } from "linkedom";
import type { AgentSettings } from "../src/core/index.ts";

it("Teaching: the research switch and a new rule each write the whole agent section", async () => {
	const dom = parseHTML("<html><body><div id='root'></div></body></html>");
	// linkedom's document has no "oninput"; without it React would watch text
	// fields an old-IE way.
	(dom.document as unknown as { oninput: null }).oninput = null;
	const globals = globalThis as Record<string, unknown>;
	const previous = new Map<string, PropertyDescriptor | undefined>();
	const bodies: Record<string, unknown> = {
		"/api/settings/prompts": { segments: [] },
		"/api/rules": { rules: [{ where: { area: "voice" }, text: "No jokes", at: "2026-10-30T12:00:00.000Z" }] },
	};
	for (const [key, value] of Object.entries({
		window: dom.window,
		document: dom.document,
		navigator: globals.navigator ?? { userAgent: "", platform: "" },
		HTMLElement: dom.window.HTMLElement,
		IS_REACT_ACT_ENVIRONMENT: true,
		fetch: async (url: string) => {
			assert.ok(url in bodies, `unexpected request: ${url}`);
			return new Response(JSON.stringify(bodies[url]));
		},
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
	let written: AgentSettings | undefined;
	try {
		await act(async () => {
			root.render(
				<ServerEventsProvider connect={quietEvents as never}>
					<TeachingSection
						agent={{ tools: { research: true }, rules: { voice: ["No jokes"] } }}
						graph={undefined}
						teacherName="Halley"
						onSectionChange={(next) => {
							written = next;
						}}
					/>
				</ServerEventsProvider>,
			);
		});
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
			input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
		});
		const enter = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
		Object.defineProperty(enter, "key", { value: "Enter" });
		await act(async () => input.dispatchEvent(enter));
		assert.deepEqual(written?.rules, { voice: ["No jokes"], facts: ["Cite the textbook"] });
		assert.equal(written?.tools?.research, true, "the rest of the section carries over");
	} finally {
		act(() => root.unmount());
		for (const [key, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globals[key];
		}
	}
});
