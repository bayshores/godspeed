/**
 * The screen takes the columns and rows that fit its box, and the shell
 * sizes the agent's terminal to match. A box too small for the smallest
 * screen shows its bottom, where the agent keeps its input and status lines.
 */
import { dom, fakeShell } from "../terminal-dom.ts";
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { createRoot } from "react-dom/client";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { TerminalView } = await import("../../src/frontend/components/terminal/terminal-view.tsx");

describe("the screen in its box", () => {
	it("is sized to its box before it attaches and again once a new size rests, and scrolls to the bottom", async () => {
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
			await act(async () => root.render(<TerminalView id="0123456789abcdef0123456789abcdef" ended={false} focusOnOpen={false} focusKey={0} files={[]} onLink={() => {}} />));
			const id = "0123456789abcdef0123456789abcdef";
			assert.deepEqual(shell.calls, [`resize ${id} 40x10`, `attach ${id}`], "a box with no room yet: the smallest screen, then the attach");
			const box = host.querySelector("[data-testid=terminal-screen]") as HTMLElement;
			Object.defineProperty(box, "clientWidth", { value: 440 });
			Object.defineProperty(box, "clientHeight", { value: 700 });
			Object.defineProperty(box, "scrollHeight", { value: 420 });
			box.scrollTop = 0;
			assert.ok(fits.length === 1, "the screen watches its box");
			fits[0]!();
			fits[0]!();
			assert.equal(shell.calls.length, 2, "nothing while the box is still being dragged");
			await act(() => new Promise((r) => setTimeout(r, 150)));
			assert.deepEqual(shell.calls.slice(2), [`resize ${id} 54x31`], "one new size once it rests");
			assert.ok(box.scrollTop === 420, `scrolled to ${box.scrollTop}`);
			fits[0]!();
			await act(() => new Promise((r) => setTimeout(r, 150)));
			assert.equal(shell.calls.length, 3, "the same size is not asked twice");
		} finally {
			await act(async () => root.unmount());
			host.remove();
			shell.remove();
			dom.window.ResizeObserver = globalThis.ResizeObserver = was;
		}
	});
});
