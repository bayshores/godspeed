/**
 * Every key in the terminal's screen goes to the agent: Escape and Ctrl+C
 * reach the terminal and never stop the teacher's turn, Tab stays in the
 * screen (the overlay's dialog does not take it), and no key reaches the
 * app's own shortcuts.
 */
import { dom, fakeShell, press } from "../terminal-dom.ts";
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { createRoot } from "react-dom/client";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { MemoryRouter } = await import("react-router");
const { KeyboardShortcuts } = await import("../../src/frontend/components/keyboard-shortcuts.tsx");
const { trapTabInDialog } = await import("../../src/frontend/components/focus-hygiene.ts");
const { TerminalView } = await import("../../src/frontend/components/terminal/terminal-view.tsx");

const ID = "0123456789abcdef0123456789abcdef";
// The dialog's Tab trap only counts controls with a box.
Object.assign(dom.window.HTMLElement.prototype, { getClientRects: () => [{}] });

describe("keys in the terminal's screen", () => {
	it("Escape, Ctrl+C and Tab reach the agent, Escape stops no turn, and no key reaches the app", async () => {
		const shell = fakeShell();
		let aborts = 0;
		let reachedApp = 0;
		const onAbort = () => aborts++;
		const onKey = () => reachedApp++;
		window.addEventListener("lh:kbd-abort-turn", onAbort);
		window.addEventListener("keydown", onKey);
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		try {
			await act(async () =>
				root.render(
					<MemoryRouter>
						<KeyboardShortcuts />
						<div role="dialog" aria-modal="true">
							<button type="button">Hide</button>
							<TerminalView id={ID} ended={false} focusOnOpen focusKey={0} />
							<button type="button">Stop</button>
						</div>
					</MemoryRouter>,
				),
			);
			const input = host.querySelector("[data-terminal-screen] textarea");
			assert.ok(input !== null, "xterm drew its input");
			press(input, "Escape", 27);
			press(input, "c", 67, true);
			press(input, "Tab", 9);
			const writes = shell.calls.filter((c) => c.startsWith("write ")).join("|");
			assert.ok(writes === "write \x1b|write \x03|write \t", `the agent got ${JSON.stringify(writes)}`);
			assert.ok(aborts === 0, "Escape stopped no turn");
			// The dialog's Tab trap leaves the screen's Tab alone (called
			// directly: this DOM runs capture listeners after the target's).
			const tab = (target: EventTarget) => {
				const e = press(document.createElement("i"), "Tab", 9);
				Object.defineProperty(e, "target", { value: target });
				trapTabInDialog(e);
				return e.defaultPrevented;
			};
			assert.ok(!tab(input), "Tab in the screen stays the agent's");
			assert.ok(tab(host.querySelector("button")!), "Tab elsewhere in the dialog still wraps");
			press(input, "a", 65);
			press(input, "Alt", 18);
			assert.ok(reachedApp === 0, `${reachedApp} keys reached the app`);
			assert.ok(shell.calls[0] === `attach ${ID}`, "the screen attached");
		} finally {
			window.removeEventListener("lh:kbd-abort-turn", onAbort);
			window.removeEventListener("keydown", onKey);
			await act(async () => root.unmount());
			host.remove();
			assert.ok(shell.calls.at(-1) === `detach ${ID}`, "the screen detached");
			shell.remove();
		}
	});
});
