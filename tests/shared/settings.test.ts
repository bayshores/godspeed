/**
 * Tests for the settings record's core layer: the delta schema's sanitizer (core/settings.ts) — strict
 * known-field validation with graceful degradation, unknown-key
 * preservation (forward-compat: a newer record must survive an older
 * app), and the factory defaults. The store/adapter tests live in
 * settings-store.test.ts; resolution in settings-resolution.test.ts.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	CURRENT_SETTINGS_VERSION,
	FACTORY_SETTINGS,
	isHexColor,
	sanitizeUserSettings,
} from "../../src/shared/core/settings.ts";

describe("FACTORY_SETTINGS (the compiled factory layer)", () => {
	it("pins the factory defaults", () => {
		assert.equal(CURRENT_SETTINGS_VERSION, 3);
		assert.equal("compaction" in FACTORY_SETTINGS, false, "the summarize point is fixed, not a setting");
		assert.deepEqual(FACTORY_SETTINGS.general, { autoUpdate: true, activeSpace: "none", teacherName: "Teacher", sounds: true, deadlineReminders: true });
		// the master switch ONLY
		assert.deepEqual(FACTORY_SETTINGS.graph, { enabled: true });
		const a = FACTORY_SETTINGS.appearance;
		assert.equal(a.background, null); // Paper
		assert.equal(a.fontFamily, null); // Literata
		assert.equal(a.proseFontSize, 17);
		assert.equal("mdRendering" in a, false);
	});

	it("has NO factory model pin — chat defaults and role overrides start absent", () => {
		assert.equal("chat" in FACTORY_SETTINGS, false);
		assert.equal("agent" in FACTORY_SETTINGS, false);
	});
});

describe("isHexColor", () => {
	it("accepts #rgb and #rrggbb (case-insensitive), rejects everything else", () => {
		for (const good of ["#fff", "#FFF", "#141414", "#8B5CF6"]) assert.equal(isHexColor(good), true, good);
		for (const bad of ["fff", "#ffff", "#gggggg", "141414", "#12345", "", "white"]) {
			assert.equal(isHexColor(bad), false, bad);
		}
	});
});

describe("sanitizeUserSettings", () => {
	it("round-trips a fully valid record field-for-field", () => {
		const record = {
			version: 1,
			general: { autoUpdate: false },
			agent: {
				tools: { research: false, quiz: true },
				rules: { voice: ["No jokes"], files: ["Quote page numbers"] },
			},
			appearance: {
				background: "#101820",
				fontFamily: "Some Font",
				proseFontSize: 18,
			},
			graph: { enabled: false },
		};
		assert.deepEqual(sanitizeUserSettings(record), record);
	});

	it("the removed Paper and White backgrounds read as Black; an old serif-titles key drops", () => {
		for (const background of ["#f4f1ea", "#FFFFFF"]) {
			assert.deepEqual(sanitizeUserSettings({ appearance: { background, sessionNameSerif: false } })?.appearance, { background: null });
		}
	});

	it("null and non-objects → null (first-boot semantics), never throws", () => {
		assert.equal(sanitizeUserSettings(null), null);
		assert.equal(sanitizeUserSettings("junk"), null);
		assert.equal(sanitizeUserSettings([1, 2]), null);
	});

	it("absent version defaults to CURRENT; unknown keys ride along VERBATIM", () => {
		const out = sanitizeUserSettings({ futureSection: { knob: 3 }, general: { autoUpdate: true } });
		assert.ok(out);
		assert.equal(out.version, CURRENT_SETTINGS_VERSION);
		assert.deepEqual((out as Record<string, unknown>).futureSection, { knob: 3 });
		assert.deepEqual(out.general, { autoUpdate: true });
	});

	it("wrong-typed fields DROP (resolve to factory), never crash", () => {
		const out = sanitizeUserSettings({
			general: { autoUpdate: "yes", sounds: "off", deadlineReminders: "on" },
			agent: { tools: { research: "no" }, rules: { voice: [1], mood: ["x"] }, models: { researcher: "fast" } },
			appearance: { proseFontSize: "16" },
			graph: { enabled: 0 },
		});
		assert.ok(out);
		assert.deepEqual(out.general, {});
		assert.deepEqual(out.agent, {});
		assert.deepEqual(out.appearance, {});
		assert.deepEqual(out.graph, {});
	});

	it("an older record's retired settings are no longer read", () => {
		const old = sanitizeUserSettings({
			version: 3,
			appearance: { proseFontSize: 18, mdRendering: { headingWeight: 800, boldColor: "#f00", italicColor: "#0f0" } },
			graph: { enabled: true, extractionChunkTokens: 2048 },
			compaction: { thresholdTokens: 64_000 },
		});
		assert.deepEqual(old?.appearance, { proseFontSize: 18 });
		assert.deepEqual(old?.graph, { enabled: true });
		assert.equal("compaction" in (old ?? {}), false);
	});

	it("out-of-range numbers CLAMP (proseFontSize)", () => {
		const out = sanitizeUserSettings({ appearance: { proseFontSize: 99 } });
		assert.ok(out);
		assert.equal(out.appearance?.proseFontSize, 24);
		const low = sanitizeUserSettings({ appearance: { proseFontSize: 4 } });
		assert.ok(low);
		assert.equal(low.appearance?.proseFontSize, 12);
	});

	it("invalid colors become null (the factory default), valid ones pass", () => {
		const out = sanitizeUserSettings({
			appearance: { background: "blue" },
		});
		assert.ok(out);
		assert.equal(out.appearance?.background, null);
		assert.equal(sanitizeUserSettings({ appearance: { background: "#f00" } })?.appearance?.background, "#f00");
	});

	it("empty strings/whitespace fontFamily → null (the default); wrong-type → null too (the default)", () => {
		for (const bad of ["", "   ", 12, { name: "x" }]) {
			const out = sanitizeUserSettings({ appearance: { fontFamily: bad } });
			assert.ok(out);
			assert.equal(out.appearance?.fontFamily, null, JSON.stringify(bad));
		}
	});

	it("legacy model settings (the outside agent is the only model) are dropped", () => {
		const out = sanitizeUserSettings({
			version: 1,
			agent: { models: { researcher: { model: { provider: "openrouter", id: "x/y" } } }, tools: { demo: false } },
			models: { strong: { model: { provider: "zai", id: "glm-5.3-flash" } } },
		});
		assert.ok(out);
		assert.equal("models" in (out.agent ?? {}), false);
		assert.equal("models" in out, false);
		assert.deepEqual(out.agent?.tools, { demo: false });
	});

	it("a legacy search-engine pin is dropped (web search was removed)", () => {
		const legacy = sanitizeUserSettings({ version: 1, agent: { search: { engine: "tavily" } } });
		assert.equal("search" in (legacy?.agent ?? {}), false);
	});

	it("graphTools subsection: boolean survives; bad shapes drop (default ON resumes)", () => {
		const on = sanitizeUserSettings({ version: 1, agent: { graphTools: { enabled: true } } });
		assert.deepEqual(on?.agent?.graphTools, { enabled: true });
		const off = sanitizeUserSettings({ version: 1, agent: { graphTools: { enabled: false } } });
		assert.deepEqual(off?.agent?.graphTools, { enabled: false });
		const bare = sanitizeUserSettings({ version: 1, agent: { graphTools: {} } });
		assert.deepEqual(bare?.agent?.graphTools, {});
		const badShape = sanitizeUserSettings({ version: 1, agent: { graphTools: "on" } });
		assert.equal(badShape?.agent?.graphTools, undefined);
		const badEnabled = sanitizeUserSettings({ version: 1, agent: { graphTools: { enabled: "yes" } } });
		assert.equal(badEnabled?.agent?.graphTools, undefined);
	});

	it("partial maps: booleans survive, non-boolean entries drop individually", () => {
		const out = sanitizeUserSettings({ agent: { tools: { quiz: false, demo: true, visual: "x" } } });
		assert.ok(out);
		assert.deepEqual(out.agent?.tools, { quiz: false, demo: true });
	});

});
