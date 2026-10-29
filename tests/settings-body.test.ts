/**
 * Tests for the section parsers (settings-storage wave, 2026-09-19):
 * src/server/settings-body.ts — general/agent/appearance/graph strictness.
 * Same discipline as parseSettingsBody (its tests live in
 * default-settings.test.ts): every known field is strict (bad type/shape
 * → 400-style error, never a silent clamp), unknown keys drop, absent
 * fields mean absent overrides. Pure — no fs.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	parseAgentSettingsBody,
	parseAppearanceSettingsBody,
	parseGeneralSettingsBody,
	parseCompactionSettingsBody,
	parseGraphSettingsBody,
	SETTINGS_SECTIONS,
} from "../src/server/settings-body.ts";

describe("parseGeneralSettingsBody", () => {
	it("parses {} and {autoUpdate} replace-whole", () => {
		const empty = parseGeneralSettingsBody({});
		assert.ok(empty.ok);
		assert.deepEqual(empty.settings, {});
		const on = parseGeneralSettingsBody({ autoUpdate: true });
		assert.ok(on.ok);
		assert.deepEqual(on.settings, { autoUpdate: true });
	});

	it("rejects non-objects and non-boolean autoUpdate", () => {
		assert.equal(parseGeneralSettingsBody("x").ok, false);
		assert.equal(parseGeneralSettingsBody({ autoUpdate: "yes" }).ok, false);
	});

	it("sounds: a boolean, anything else is a 400", () => {
		const off = parseGeneralSettingsBody({ sounds: false });
		assert.ok(off.ok);
		assert.deepEqual(off.settings, { sounds: false });
		assert.equal(parseGeneralSettingsBody({ sounds: "off" }).ok, false);
	});
});

describe("parseAgentSettingsBody", () => {
	it("tools: a boolean map; non-boolean values are 400s", () => {
		const r = parseAgentSettingsBody({ tools: { research: false } });
		assert.ok(r.ok);
		assert.deepEqual(r.settings.tools, { research: false });
		assert.equal(parseAgentSettingsBody({ tools: { quiz: "no" } }).ok, false);
	});

	it("rules: known areas, each a list of strings, cleaned on the way in", () => {
		const r = parseAgentSettingsBody({ rules: { voice: ["  No jokes ", "", "No jokes"], facts: [] } });
		assert.ok(r.ok);
		assert.deepEqual(r.settings.rules, { voice: ["No jokes"] });
		assert.equal(parseAgentSettingsBody({ rules: { mood: ["x"] } }).ok, false, "unknown area");
		assert.equal(parseAgentSettingsBody({ rules: { voice: "x" } }).ok, false, "not a list");
		assert.equal(parseAgentSettingsBody({ rules: { voice: [1] } }).ok, false, "not strings");
		assert.equal(parseAgentSettingsBody({ rules: [] }).ok, false, "not an object");
	});


	it("graphTools: strict object subsection, enabled boolean when present — wave 7, 2026-09-23", () => {
		const off = parseAgentSettingsBody({ graphTools: { enabled: false } });
		assert.ok(off.ok);
		assert.deepEqual(off.settings.graphTools, { enabled: false });
		const bare = parseAgentSettingsBody({ graphTools: {} });
		assert.ok(bare.ok);
		assert.deepEqual(bare.settings.graphTools, {}, "explicit subsection with no key = the default ON");
		assert.equal(parseAgentSettingsBody({ graphTools: "off" }).ok, false, "graphTools must be an object");
		assert.equal(parseAgentSettingsBody({ graphTools: { enabled: "yes" } }).ok, false, "enabled must be a boolean");
		assert.equal(parseAgentSettingsBody({ graphTools: null }).ok, false);
	});

	it("an empty {} agent section parses to {} (replace-whole clear)", () => {
		const r = parseAgentSettingsBody({});
		assert.ok(r.ok);
		assert.deepEqual(r.settings, {});
	});
});

describe("parseAppearanceSettingsBody", () => {
	it("parses every field; hex-or-null colors; clamps happen at sanitize, rejects here", () => {
		const r = parseAppearanceSettingsBody({
			background: "#ffffff",
			fontFamily: "Some Font",
			proseFontSize: 20,
			sessionNameSerif: false,
			mdRendering: { headingWeight: 700, boldColor: "#ff8800", italicColor: null },
		});
		assert.ok(r.ok);
		assert.deepEqual(r.settings, {
			background: "#ffffff",
			fontFamily: "Some Font",
			proseFontSize: 20,
			sessionNameSerif: false,
			mdRendering: { headingWeight: 700, boldColor: "#ff8800", italicColor: null },
		});
	});

	it("rejects bad ranges and colors — with specific messages, never clamps", () => {
		const cases: unknown[] = [
			{ background: "blue" },
			{ background: 42 },
			{ fontFamily: "" },
			{ fontFamily: 12 },
			{ proseFontSize: 30 },
			{ proseFontSize: 64.5 },
			{ sessionNameSerif: 1 },
			{ mdRendering: { headingWeight: 1000 } },
			{ mdRendering: { boldColor: "red" } },
		];
		for (const body of cases) {
			assert.equal(parseAppearanceSettingsBody(body).ok, false, JSON.stringify(body));
		}
		// boundary values that MUST pass: 12 and 24, 100 and 900, #fff
		assert.ok(parseAppearanceSettingsBody({ proseFontSize: 12 }));
		assert.ok(parseAppearanceSettingsBody({ proseFontSize: 24 }));
		assert.ok(parseAppearanceSettingsBody({ mdRendering: { headingWeight: 100 } }));
		assert.ok(parseAppearanceSettingsBody({ mdRendering: { headingWeight: 900 } }));
		assert.ok(parseAppearanceSettingsBody({ background: "#abc" }));
		// null = the factory value — explicit, valid
		assert.ok(parseAppearanceSettingsBody({ background: null, fontFamily: null }));
	});

	it("rejects non-object bodies and non-object mdRendering", () => {
		assert.equal(parseAppearanceSettingsBody([1]).ok, false);
		assert.equal(parseAppearanceSettingsBody({ mdRendering: "big" }).ok, false);
	});
});

describe("parseGraphSettingsBody", () => {
	it("parses the collapsed section replace-whole (wave 7: the master switch ONLY)", () => {
		const r = parseGraphSettingsBody({ enabled: false });
		assert.ok(r.ok);
		assert.deepEqual(r.settings, { enabled: false });
		assert.equal(parseGraphSettingsBody({}).ok, true);
	});

	it("rejects non-boolean switches and unknown bodies", () => {
		assert.equal(parseGraphSettingsBody({ enabled: "off" }).ok, false);
		assert.equal(parseGraphSettingsBody("nope").ok, false);
	});

	it("the removed rendering switch (2026-10-27) is no longer read from a body", () => {
		const body = parseGraphSettingsBody({ enabled: true, rendering: false });
		assert.ok(body.ok);
		assert.deepEqual(body.settings, { enabled: true });
	});

	it("extractionChunkTokens: whole tokens ≥ the 500 floor (extraction-UX redesign, 2026-09-24)", () => {
		const ok = parseGraphSettingsBody({ enabled: true, extractionChunkTokens: 2048 });
		assert.ok(ok.ok);
		assert.deepEqual(ok.settings, { enabled: true, extractionChunkTokens: 2048 });
		// absent = unset — replace-whole keeps the factory default at resolution
		const absent = parseGraphSettingsBody({ enabled: true });
		assert.ok(absent.ok);
		assert.deepEqual(absent.settings, { enabled: true });
		// fractions floor to whole tokens
		const fraction = parseGraphSettingsBody({ extractionChunkTokens: 1024.9 });
		assert.ok(fraction.ok);
		assert.equal(fraction.settings.extractionChunkTokens, 1024);
		// below the cost floor: 400 with the floor named (penny-batches)
		const tiny = parseGraphSettingsBody({ extractionChunkTokens: 100 });
		assert.equal(tiny.ok, false, "below-floor rejected");
		assert.match(tiny.ok === false ? tiny.error : "", /at least 500/);
		// junk shapes: 400
		assert.equal(parseGraphSettingsBody({ extractionChunkTokens: "4096" }).ok, false);
		assert.equal(parseGraphSettingsBody({ extractionChunkTokens: NaN }).ok, false);
		assert.equal(parseGraphSettingsBody({ extractionChunkTokens: null }).ok, false);
	});

	it("the dead wave-6 rungs in a body are ignored — the section collapses on write", () => {
		// Old clients may still send {embedding: true, embeddingModel: …};
		// the parser reads ONLY the master switch — the dead keys are not
		// an error, they are just not part of the section anymore.
		const r = parseGraphSettingsBody({ enabled: false, clustering: true, labeling: true });
		assert.ok(r.ok);
		assert.deepEqual(r.settings, { enabled: false });
	});
});

describe("parseCompactionSettingsBody (owner round 14)", () => {
	it("parses a threshold; absent = the empty section (factory default at resolution)", () => {
		const r = parseCompactionSettingsBody({ thresholdTokens: 120000 });
		assert.ok(r.ok);
		assert.deepEqual(r.settings, { thresholdTokens: 120000 });
		const none = parseCompactionSettingsBody({});
		assert.ok(none.ok);
		assert.deepEqual(none.settings, {});
	});
	it("floors to integers", () => {
		const r = parseCompactionSettingsBody({ thresholdTokens: 120000.9 });
		assert.ok(r.ok);
		assert.equal(r.settings.thresholdTokens, 120000);
	});
	it("rejects below the 32k floor with the anti-churn rationale", () => {
		const r = parseCompactionSettingsBody({ thresholdTokens: 20_000 });
		assert.ok(!r.ok);
		assert.match(r.error ?? "", /at least 32000/);
		assert.match(r.error ?? "", /churn/);
	});
	it("rejects non-numbers", () => {
		const r = parseCompactionSettingsBody({ thresholdTokens: "big" });
		assert.ok(!r.ok);
		assert.match(r.error ?? "", /must be a number/);
	});
});

describe("SETTINGS_SECTIONS (the route's section map)", () => {
	it("maps exactly the five record sections", () => {
		// compaction joined (owner round 14): its own section PUT — the
		// threshold is engine behavior, not an agent-section key.
		assert.deepEqual(
			Object.keys(SETTINGS_SECTIONS),
			["general", "agent", "appearance", "graph", "compaction"],
		);
	});
});
