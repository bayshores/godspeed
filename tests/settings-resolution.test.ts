/**
 * Tests for the resolution layer: core/settings-resolution.ts — the
 * delta→concrete projection. There are no model settings anymore: the
 * outside agent (MCP) is the only model (owner, 2026-10-27).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	extractionEnabled,
	graphToolsEnabled,
	resolveSettings,
} from "../src/core/settings-resolution.ts";
import type { UserSettings } from "../src/core/settings.ts";

describe("resolveSettings", () => {
	it("null record (first boot): every knob lands on its factory default", () => {
		const eff = resolveSettings(null);
		assert.deepEqual(eff.general, { autoUpdate: true, activeClass: "none", teacherName: "Halley" });
		assert.deepEqual(eff.agent.tools, {});
		assert.deepEqual(eff.agent.prompts, {});
		assert.equal(eff.appearance.mode, "dark");
		assert.equal(eff.appearance.background, null);
		assert.equal(eff.appearance.fontFamily, null);
		assert.equal(eff.appearance.proseFontSize, 16);
		assert.equal(eff.appearance.sessionNameSerif, true);
		assert.equal(eff.appearance.mdRendering.headingWeight, 900);
		// wave 7 collapse: the master switch ONLY + the redesign's chunk
		// budget — absent record resolves the factory 4096 (halved back
		// from the digest-era 8192, owner, 2026-10-13)
		assert.deepEqual(eff.graph, { enabled: true, extractionChunkTokens: 4096 });
	});

	it("explicit record values win over every factory default", () => {
		const record: UserSettings = {
			version: 1,
			general: { autoUpdate: false },
			agent: {
				tools: { research: false },
				prompts: { "system-prompt.md": true },
			},
			appearance: { mode: "light", proseFontSize: 20, mdRendering: { headingWeight: 600 } },
			graph: { enabled: false },
		};
		const eff = resolveSettings(record);
		assert.equal(eff.general.autoUpdate, false);
		assert.deepEqual(eff.agent.tools, { research: false });
		assert.deepEqual(eff.agent.prompts, { "system-prompt.md": true });
		assert.equal(eff.appearance.mode, "light");
		assert.equal(eff.appearance.proseFontSize, 20);
		assert.equal(eff.appearance.mdRendering.headingWeight, 600);
		// wave 7 collapse: the section IS the master switch (absent budget
		// field = factory 4096 — a pre-redesign record resolves cleanly).
		assert.deepEqual(eff.graph, { enabled: false, extractionChunkTokens: 4096 });
		
		// The chunk budget rides the same resolution: stored value wins.
		const budgeted = resolveSettings({ version: 1, graph: { extractionChunkTokens: 2000 } });
		assert.deepEqual(budgeted.graph, { enabled: true, extractionChunkTokens: 2000 });
	});

	it("an old record's graph.rendering (removed 2026-10-27) is not read", () => {
		const eff = resolveSettings({ version: 1, graph: { rendering: false } as never });
		assert.deepEqual(eff.graph, { enabled: true, extractionChunkTokens: 4096 });
		assert.equal(extractionEnabled(eff.graph), true);
	});
});

describe("the graph channel gates (the wave's seam honoring)", () => {
	it("WRITE channel (extraction): dies with the master switch — the ONLY graph setting since wave 7", () => {
		assert.equal(extractionEnabled({ enabled: true }), true);
		assert.equal(extractionEnabled({ enabled: false }), false);
	});

	it("the write gate rides resolveSettings' factory defaults (all on → open)", () => {
		const eff = resolveSettings(null);
		assert.equal(extractionEnabled(eff.graph), true);
		const off = resolveSettings({ version: 1, graph: { enabled: false } });
		assert.equal(extractionEnabled(off.graph), false);
	});

	it("PROBER GRAPH TOOLS gate (wave 7, owner ruling 2026-09-23): the agent toggle AND the graph master switch compose", () => {
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