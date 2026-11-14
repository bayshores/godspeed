/**
 * A box too short for the screen at the smallest font shows the screen's
 * bottom, where the agent keeps its input and status lines.
 */
import { dom, fakeShell } from "../terminal-dom.ts";
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { createRoot } from "react-dom/client";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { TerminalView } = await import("../../src/frontend/components/terminal/terminal-view.tsx");

describe("the screen in a small box", () => {
	it("scrolls to the bottom whenever its box changes size", async () => {
		const shell = fakeShell();
		const fits: Array<() => void> = [];
		const was = dom.window.ResizeObserver;
		dom.window.ResizeObserver = globalThis.ResizeObserver = class {
			constructor(cb: () => void) {
				fits.push(cb);
			}
			observe() {}
			disconnect() {}
		} as unknown as typeof ResizeObserver;
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		try {
			await act(async () => root.render(<TerminalView id="0123456789abcdef0123456789abcdef" ended={false} focusOnOpen={false} focusKey={0} />));
			const box = host.querySelector("[data-testid=terminal-screen]") as HTMLElement;
			Object.defineProperty(box, "scrollHeight", { value: 420 });
			box.scrollTop = 0;
			assert.ok(fits.length === 1, "the screen watches its box");
			fits[0]!();
			assert.ok(box.scrollTop === 420, `scrolled to ${box.scrollTop}`);
		} finally {
			await act(async () => root.unmount());
			host.remove();
			shell.remove();
			dom.window.ResizeObserver = globalThis.ResizeObserver = was;
		}
	});
});
