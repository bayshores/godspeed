import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseModelsRefusal, parseProviderNotConnectedRefusal } from "../src/components/chat.tsx";
import { prefillFromSlots, prefillLevelFromPin, setupStage } from "../src/components/setup-dialog.tsx";
import {
	isModelsRefusal,
	isProviderNotConnectedRefusal,
	modelsNotConfigured,
	providerNotConnected,
	PROVIDER_NOT_CONNECTED_CODE,
} from "../src/core/settings.ts";
import type { ModelCatalogEntry, ModelSlotName } from "../src/core/index.ts";

/**
 * The BYOK universal gate rendered honestly (owner, 2026-09-22): the server
 * refuses ALL turns with 503 {error, code: "models_not_configured", missing}
 * when a slot tier is unset. These pin the client's pure seams: the refusal
 * detector (the transport throws the 503 body verbatim as the error text),
 * the job-record refusal matcher, and the SetupDialog's prefill.
 */

const REFUSAL = JSON.stringify(modelsNotConfigured(["strong"]));

describe("parseModelsRefusal — the send refusal detector", () => {
	it("reads the missing tiers from the envelope text", () => {
		assert.deepEqual(parseModelsRefusal(REFUSAL), ["strong"]);
		assert.deepEqual(parseModelsRefusal(JSON.stringify(modelsNotConfigured(["strong", "vision"]))), [
			"strong",
			"vision",
		]);
	});

	it("anything else is a real error — null, the honest banner stays", () => {
		assert.equal(parseModelsRefusal(undefined), null);
		assert.equal(parseModelsRefusal("Something went wrong"), null); // not JSON
		assert.equal(parseModelsRefusal('{"error":"A turn is already running"}'), null); // JSON, wrong code
		assert.equal(parseModelsRefusal('{"code":"models_not_configured","missing":"strong"}'), null); // missing not an array
		assert.equal(parseModelsRefusal('{"code":"models_not_configured","missing":[42]}'), null); // tiers are strings
	});
});

describe("isModelsRefusal — the job-record matcher", () => {
	it("matches the runner's composed wording, not real failures", () => {
		assert.equal(isModelsRefusal(`${modelsNotConfigured(["vision"]).error} (missing: vision)`), true);
		assert.equal(isModelsRefusal(modelsNotConfigured(["cheap"]).error), true);
		assert.equal(isModelsRefusal(undefined), false);
		assert.equal(isModelsRefusal("FAILED: headless crashed"), false);
	});
});

describe("providerNotConnected — the envelope factory", () => {
	it("names the provider from the curated label and carries the exact machine code", () => {
		const envelope = providerNotConnected("chatgpt", ["strong"]);
		assert.deepEqual(envelope, {
			error: "ChatGPT is not connected — sign in under Settings → Providers",
			code: PROVIDER_NOT_CONNECTED_CODE,
			provider: "chatgpt",
			slots: ["strong"],
		});
		assert.equal(envelope.code, "provider_not_connected");
	});

	it("an unknown provider falls back to its raw id as the label", () => {
		const envelope = providerNotConnected("weird", ["cheap"]);
		assert.equal(envelope.error, "weird is not connected — sign in under Settings → Providers");
	});
});

describe("parseProviderNotConnectedRefusal — the send refusal detector's twin", () => {
	it("reads the envelope's own code + invariant tail — the wording can never drift client-side", () => {
		const REFUSED = JSON.stringify(providerNotConnected("chatgpt", ["strong"]));
		assert.equal(parseProviderNotConnectedRefusal(REFUSED), true);
		assert.equal(parseProviderNotConnectedRefusal(JSON.stringify(providerNotConnected("xai-subscription", ["strong", "vision"]))), true);
	});

	it("anything else is a real error — false, the honest banner stays", () => {
		assert.equal(parseProviderNotConnectedRefusal(REFUSAL), false); // the models refusal is NOT this one
		assert.equal(parseProviderNotConnectedRefusal("FAILED: headless crashed"), false);
		assert.equal(parseProviderNotConnectedRefusal(undefined), false);
		assert.equal(parseProviderNotConnectedRefusal("{not json"), false);
	});
});

describe("isProviderNotConnectedRefusal — the job-record matcher", () => {
	it("matches the envelope wording regardless of provider label, not real failures", () => {
		assert.equal(isProviderNotConnectedRefusal(providerNotConnected("github-copilot-subscription", ["cheap"]).error), true);
		assert.equal(isProviderNotConnectedRefusal(providerNotConnected("chatgpt", ["strong"]).error), true);
		assert.equal(isProviderNotConnectedRefusal(""), false);
		assert.equal(isProviderNotConnectedRefusal(undefined), false);
		assert.equal(isProviderNotConnectedRefusal("FAILED: headless crashed"), false);
		assert.equal(isProviderNotConnectedRefusal(modelsNotConfigured(["strong"]).error), false, "the models refusal is a different failure");
	});
});

describe("prefillFromSlots — the SetupDialog prefill (BYOK wave)", () => {
	const entry = (id: string, provider: string): ModelCatalogEntry => ({
		id,
		name: id,
		provider,
		reasoning: false,
		input: ["text"],
		supportedLevels: ["low"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 1024,
	});
	const catalog = [entry("glm-5.3-flash", "z-ai"), entry("qwen3.8-flash", "qwen")];
	const pins = (strong: boolean, vision: boolean) => ({
		strong: strong ? { model: { provider: "z-ai", id: "glm-5.3-flash" } } : null,
		cheap: null,
		vision: vision ? { model: { provider: "qwen", id: "qwen3.8-flash" } } : null,
	});

	it("prefills exactly the pinned tiers, matched by provider AND id", () => {
		const pre = prefillFromSlots(catalog, pins(true, true));
		assert.equal(pre.strong?.id, "glm-5.3-flash");
		assert.equal(pre.vision?.id, "qwen3.8-flash");
		assert.equal(pre.cheap, undefined);
	});

	it("nothing pinned (first-run) → nothing prefilled — all three marked needed", () => {
		const pre = prefillFromSlots(catalog, pins(false, false));
		assert.deepEqual(pre, {});
	});

	it("a pin whose model left the federated catalog does not prefill (signed out)", () => {
		const pre = prefillFromSlots(catalog, { strong: { model: { provider: "gone", id: "vanished" } }, cheap: null, vision: null });
		assert.deepEqual(pre, {});
	});

	it("provider collisions never cross-pollute (same id, different provider)", () => {
		const both = [entry("shared-id", "openai"), entry("shared-id", "openrouter")];
		const pre = prefillFromSlots(both, { strong: { model: { provider: "openrouter", id: "shared-id" } }, cheap: null, vision: null });
		assert.equal(pre.strong?.provider, "openrouter");
	});

	it("absent slots payload (older shape) prefills nothing", () => {
		const pre = prefillFromSlots(catalog, undefined);
		assert.deepEqual(pre, {});
	});
});

describe("prefillLevelFromPin — the setup dialog's level prefill (chunk 2)", () => {
	const entry = (levels: string[]) =>
		({ id: "m", name: "M", provider: "p", reasoning: true, input: ["text"], supportedLevels: levels, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000, maxTokens: 1000 }) as never;

	it("a stored level the pinned model still supports prefills as-is", () => {
		assert.equal(prefillLevelFromPin(entry(["low", "high"]), { thinkingLevel: "high" }), "high");
	});

	it("a stored level the model LOST rides as-is — Save clamps server-side (bd68486)", () => {
		assert.equal(prefillLevelFromPin(entry(["minimal", "medium"]), { thinkingLevel: "xhigh" }), "xhigh");
	});

	it("a legacy pin with no stored level prefills the ordering's level", () => {
		assert.equal(prefillLevelFromPin(entry(["low", "medium"]), {}), "medium");
		assert.equal(prefillLevelFromPin(entry(["low", "medium"]), null), "medium");
	});
});

describe("setupStage — connect first", () => {
	it("connect first (owner ordering), pickers when a subscription is connected", () => {
		assert.equal(setupStage(null), "connect");
		assert.equal(setupStage([{ id: "x", connected: false }]), "connect");
		assert.equal(setupStage([{ id: "x", connected: true }]), "pickers");
	});
});