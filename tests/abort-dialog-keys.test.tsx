/**
 * The open Skip or Discard confirm owns Enter and digits: the dock's
 * Enter submit underneath must not fire, or Enter on "Discard this
 * problem?" would send the problem instead.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AbortTurnDialog } from "../src/components/abort-turn-dialog.tsx";
import { useEnterSubmits } from "../src/components/enter-submits.ts";

const dom = parseHTML("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
});

function Dock({ onSubmit }: { onSubmit: () => void }) {
	useEnterSubmits(onSubmit);
	return null;
}

function enterOn(target: EventTarget): KeyboardEvent {
	const e = new dom.window.Event("keydown", { bubbles: true, cancelable: true }) as unknown as KeyboardEvent;
	Object.defineProperty(e, "key", { value: "Enter" });
	target.dispatchEvent(e);
	return e;
}

async function mounted(el: React.ReactElement, run: () => Promise<void>) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	try {
		await act(async () => root.render(el));
		await run();
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
}

describe("the abort confirm and Enter", () => {
	it("Enter outside the open confirm does not reach the dock's submit", async () => {
		let submits = 0;
		await mounted(
			<>
				<Dock onSubmit={() => submits++} />
				<AbortTurnDialog mode="problem" onClose={() => {}} onConfirm={() => {}} />
			</>,
			async () => {
				const e = enterOn(document.body);
				assert.equal(submits, 0);
				assert.equal(e.defaultPrevented, true, "the button underneath does not re-fire");
			},
		);
	});

	it("Enter reaches the dock again once the confirm is closed", async () => {
		let submits = 0;
		await mounted(
			<>
				<Dock onSubmit={() => submits++} />
				<AbortTurnDialog mode={null} onClose={() => {}} onConfirm={() => {}} />
			</>,
			async () => {
				enterOn(document.body);
				assert.equal(submits, 1);
			},
		);
	});
});
