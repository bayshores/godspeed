/**
 * The no-connection seams (subscriptions only — API keys were removed):
 * the composer pill's SSR shape, the setup dialog's connect screen, and
 * the strong-slot pre-send guard (no-orphan-chats).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectPill, strongDisconnected } from "../src/components/setup-cta.tsx";
import { setupStage } from "../src/components/setup-dialog.tsx";
import type { ModelCatalogResponse } from "../src/core/index.ts";

describe("ConnectPill — the composer-hoisted notice", () => {
	it("takes the CTA's chrome with its own testid and copy", () => {
		const html = renderToStaticMarkup(createElement(ConnectPill, { onOpen: () => {} }));
		assert.ok(html.includes('data-testid="setup-cta-connect"'));
		assert.match(html, />Sign in to a subscription<\/button>/);
		assert.ok(!html.includes('data-testid="setup-cta"'), "the models CTA's testid never rides the pill");
	});
});

describe("setupStage — connect first, then models", () => {
	it("no connected subscription (or no read yet) is the connect stage", () => {
		assert.equal(setupStage(null), "connect");
		assert.equal(setupStage([]), "connect");
		assert.equal(setupStage([{ id: "chatgpt", connected: false }]), "connect");
	});

	it("any connected subscription opens the pickers", () => {
		assert.equal(setupStage([{ id: "chatgpt", connected: false }, { id: "xai-subscription", connected: true }]), "pickers");
	});
});

/** A minimal catalog double — the strong pin and the connected providers. */
const catalog = (strongProvider: string | null, ...connected: string[]): ModelCatalogResponse => ({
	models: [],
	defaults: null,
	rolePins: { researcher: null, demoBuilder: null, visualMaker: null, extractor: null, auditor: null },
	slots: {
		strong: strongProvider ? { model: { provider: strongProvider, id: `${strongProvider}/model` }, thinkingLevel: "low" } : null,
		cheap: null,
		vision: null,
	},
	providers: connected.map((id) => ({ id, connected: true })),
});

describe("strongDisconnected — the pre-send guard's truth", () => {
	it("strong pinned to a provider that is not connected: the guard fires", () => {
		assert.equal(strongDisconnected(catalog("chatgpt", "xai-subscription")), true);
		assert.equal(strongDisconnected(catalog("openrouter", "chatgpt")), true, "a legacy API-key pin is disconnected");
	});

	it("strong provider connected: the guard does not fire", () => {
		assert.equal(strongDisconnected(catalog("chatgpt", "chatgpt")), false);
		const lying = catalog("chatgpt", "chatgpt");
		lying.providers[0]!.connected = false;
		assert.equal(strongDisconnected(lying), true, "a row only counts when connected");
	});

	it("no strong pin or no catalog yet: false — the server gate remains the belt", () => {
		assert.equal(strongDisconnected(catalog(null, "chatgpt")), false);
		assert.equal(strongDisconnected(undefined), false);
	});
});
