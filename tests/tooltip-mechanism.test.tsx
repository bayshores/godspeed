/**
 * Tooltip mechanism pins: icon and pill controls ride the styled Radix
 * tooltip via Hint with no wrapper DOM; the copy carries no internal
 * vocabulary.
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Hint } from "../src/components/ui/hint.tsx";
import { TOOLTIP_DELAY_MS } from "../src/components/ui/tooltip.tsx";
import { AUTO_UPDATE_HINT } from "../src/components/settings/update-settings.tsx";

describe("hover delay", () => {
	it("tooltips open after a 150ms hover (focus opens them at once — tests/tooltip-focus)", () => {
		assert.equal(TOOLTIP_DELAY_MS, 150);
	});
});

describe("spot-pins: the dev-speak cull", () => {
	it("the auto-update hint is honest user language — no stream jargon", () => {
		assert.equal(AUTO_UPDATE_HINT, "Check at startup and every 24 hours. Turning this off does not stop updates already in progress or ready to install.");
		assert.ok(!AUTO_UPDATE_HINT.includes("wave"), "no stream vocabulary");
	});
});

describe("Hint — the mechanism (SSR: the tooltip itself stays closed)", () => {
	it("asChild: no wrapper DOM — the control keeps its own testid and classes", () => {
		const html = renderToStaticMarkup(
			createElement(Hint, {
				label: "Settings",
				children: createElement("button", { "data-testid": "settings-toggle", className: "the-quiet-chrome" }, "Settings"),
			}),
		);
		assert.match(html, /^<button/, "the trigger IS the button — nothing wraps it");
		assert.ok(html.includes('data-testid="settings-toggle"'));
		assert.ok(html.includes("the-quiet-chrome"));
		assert.ok(!html.includes("<span"), "no portal content renders while closed");
	});
});