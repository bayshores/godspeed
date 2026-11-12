/**
 * The instructions panel sends one request at a time (Save and Reset wait
 * for it), and a request that never reaches the app shows the panel's
 * own "Could not save" line instead of failing silently.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseHTML } from "linkedom";

const dom = parseHTML("<html><body><div id='root'></div></body></html>");
(dom.document as unknown as { oninput: null }).oninput = null;
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	HTMLElement: dom.window.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
});

const { createRoot } = await import("react-dom/client");
const { InstructionsPanel } = await import("../../src/frontend/components/settings/instructions-panel.tsx");

const area = { id: "voice", label: "Voice", about: "", parts: ["shared/10-voice.md"] } as const;
const part = { path: "shared/10-voice.md", sourceText: "Original", overrideText: "Mine", shared: true };

function buttons() {
	const all = [...document.querySelectorAll<HTMLButtonElement>("footer button")];
	return { reset: all[0]!, save: all[1]! };
}

describe("InstructionsPanel", () => {
	it("disables Save and Reset while a request runs, and shows a failed one", async () => {
		let finish: (res: Response) => void = () => {};
		let fail = false;
		globalThis.fetch = (() => (fail ? Promise.reject(new TypeError("offline")) : new Promise<Response>((resolve) => (finish = resolve)))) as typeof fetch;
		const root = createRoot(document.getElementById("root")!);
		await act(async () => root.render(<InstructionsPanel area={{ ...area }} parts={[part]} teacherName="Teacher" onChanged={() => {}} onClose={() => {}} />));

		await act(async () => buttons().reset.click());
		assert.equal(buttons().reset.disabled, true, "Reset waits for its request");
		assert.equal(buttons().save.disabled, true);
		await act(async () => finish(new Response(null, { status: 500 })));
		assert.equal(buttons().reset.disabled, false);
		assert.match(document.querySelector("footer")!.textContent!, /Could not reset\. Try again\./);

		fail = true;
		await act(async () => buttons().reset.click());
		assert.match(document.querySelector("footer")!.textContent!, /Could not reset\. Try again\./, "an unreachable app is a failure too");
		assert.equal(buttons().reset.disabled, false);
		await act(async () => root.unmount());
	});
});
