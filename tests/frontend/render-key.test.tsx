/** A busy key: disabled, full opacity, its label kept in place, a spinner over it. */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

const { Key } = await import("../../src/frontend/components/ui/key.tsx");

describe("a key", () => {
	it("busy: disabled, aria-busy, its label kept, one spinner, full opacity", () => {
		const html = renderToStaticMarkup(<Key busy>Study</Key>);
		assert.match(html, /disabled=""/);
		assert.match(html, /aria-busy="true"/);
		assert.match(html, /disabled:opacity-100/);
		assert.match(html, />Study<\/span>/);
		assert.equal(html.split('data-testid="braille-spinner"').length - 1, 1);
	});

	it("not busy: no spinner, no aria-busy, not disabled", () => {
		const html = renderToStaticMarkup(<Key>Study</Key>);
		assert.ok(!html.includes("braille-spinner"));
		assert.ok(!html.includes("aria-busy"));
		assert.ok(!html.includes('disabled=""'));
	});

	it("is the app's key, and a submit type and a plain disabled still work", () => {
		const html = renderToStaticMarkup(
			<Key type="submit" disabled className="lh-btn-main">
				Go
			</Key>,
		);
		assert.match(html, /type="submit"/);
		assert.match(html, /class="lh-btn lh-btn-main"/);
		assert.match(html, /disabled=""/);
	});
});
