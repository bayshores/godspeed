/**
 * Tests for the resolution layer: core/settings-resolution.ts — the
 * delta→concrete projection. There are no model settings anymore: the
 * outside agent (MCP) is the only model.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { graphToolsEnabled, resolveSettings } from "../../src/shared/core/settings-resolution.ts";
import type { UserSettings } from "../../src/shared/core/settings.ts";

describe("resolveSettings", () => {
	it("null record (first boot): every knob lands on its factory default", () => {
		const eff = resolveSettings(null);
		assert.deepEqual(eff.general, { autoUpdate: true, activeSpace: "none", teacherName: "Teacher", sounds: true, deadlineReminders: true });
		assert.deepEqual(eff.agent.tools, {});
		assert.deepEqual(eff.agent.rules, {});
		assert.equal(eff.appearance.background, null);
		assert.equal(eff.appearance.fontFamily, null);
		assert.equal(eff.appearance.proseFontSize, 17);
		// the master switch ONLY
		assert.deepEqual(eff.graph, { enabled: true });
		assert.equal("compaction" in eff, false);
	});

	it("explicit record values win over every factory default", () => {
		const record: UserSettings = {
			version: 1,
			general: { autoUpdate: false, sounds: false, deadlineReminders: false },
			agent: {
				tools: { research: false },
				rules: { voice: ["No jokes"] },
			},
			appearance: { proseFontSize: 20 },
			graph: { enabled: false },
		};
		const eff = resolveSettings(record);
		assert.equal(eff.general.autoUpdate, false);
		assert.equal(eff.general.sounds, false);
		assert.equal(eff.general.deadlineReminders, false);
		assert.deepEqual(eff.agent.tools, { research: false });
		assert.deepEqual(eff.agent.rules, { voice: ["No jokes"] });
		assert.equal(eff.appearance.proseFontSize, 20);
		assert.deepEqual(eff.graph, { enabled: false });
	});

	it("an older record's retired values resolve to nothing: heading weight, bold and italic colors, the chunk budget, the summarize point", () => {
		const old = { version: 3, appearance: { proseFontSize: 18, mdRendering: { headingWeight: 800, boldColor: "#f00" } }, graph: { extractionChunkTokens: 2000 }, compaction: { thresholdTokens: 64_000 } } as unknown as UserSettings;
		const eff = resolveSettings(old);
		assert.deepEqual(eff.appearance, { background: null, fontFamily: null, proseFontSize: 18 });
		assert.deepEqual(eff.graph, { enabled: true });
		assert.equal("compaction" in eff, false);
	});

	it("an old record's graph.rendering (removed) is not read", () => {
		const eff = resolveSettings({ version: 1, graph: { rendering: false } as never });
		assert.deepEqual(eff.graph, { enabled: true });
	});
});

describe("the graph channel gates (the wave's seam honoring)", () => {
	it("PROBER GRAPH TOOLS gate: the agent toggle AND the graph master switch compose", () => {
		const graph = { enabled: true };
		assert.equal(graphToolsEnabled({ graph, agent: { graphTools: {} } }), true, "absent subsection = ON");
		assert.equal(graphToolsEnabled({ graph, agent: { graphTools: { enabled: true } } }), true);
		assert.equal(graphToolsEnabled({ graph, agent: { graphTools: { enabled: false } } }), false);
		const dead = { ...graph, enabled: false };
		assert.equal(graphToolsEnabled({ graph: dead, agent: { graphTools: { enabled: true } } }), false, "graph off kills the tools regardless of the toggle");
	});

	it("graphTools rides resolveSettings: absent record → the empty subsection (ON); a record's delta passes through", () => {
		const eff = resolveSettings(null);
		assert.deepEqual(eff.agent.graphTools, {});
		const off = resolveSettings({ version: 1, agent: { graphTools: { enabled: false } } });
		assert.deepEqual(off.agent.graphTools, { enabled: false });
	});
});