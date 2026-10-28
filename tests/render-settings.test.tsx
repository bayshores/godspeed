/**
 * Settings-surface render tests (thin settings wave): SSR of the section
 * components pins the THIN markup — toggle rows, the graph ladder's
 * graying, the mode control's honest disabled state and the tool rows. Fetches don't run under renderToStaticMarkup (effects never
 * fire), so the SSR state IS the loading state — asserted as such.
 * Same tsx classic-JSX shim as render-sidebar.test.tsx.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TOGGLE_TOOLS, AgentSection } from "../components/settings/agent-section.tsx";
import { AppearanceSection, GraphSection } from "../components/settings/appearance-section.tsx";
import { KeyboardSection } from "../components/settings/keyboard-section.tsx";
import type { GraphSettings } from "../src/core/index.ts";
import { SettingsDialogBody, SettingsDialogProvider } from "../components/settings/settings-dialog.tsx";
import { KEYBOARD_ACTIONS } from "../src/core/index.ts";

/** The full opening tag of the element carrying a testid — attribute
 *  order in React output is not contractual, so assertions run on the
 *  whole tag instead of ordered regex chains. */
function tagOf(html: string, testid: string): string {
	const i = html.indexOf(`data-testid="${testid}"`);
	assert.ok(i >= 0, `missing ${testid}`);
	return html.slice(html.lastIndexOf("<", i), html.indexOf(">", i) + 1);
}

describe("SettingsDialog (the designed surface, SSR)", () => {
	it("provider CLOSED: children only — no dialog, no portal content", () => {
		const html = renderToStaticMarkup(
			<SettingsDialogProvider>
				<p>the app</p>
			</SettingsDialogProvider>,
		);
		assert.ok(html.includes("the app"));
		assert.ok(!html.includes("settings-backdrop"));
		assert.ok(!html.includes("settings-dialog"));
	});

	it("the dialog frame: role=dialog + the ✕ + the five-section nav, Outside agents first and General last", () => {
		const html = renderToStaticMarkup(<SettingsDialogBody onClose={() => {}} />);
		assert.ok(html.includes('role="dialog"'));
		assert.ok(html.includes('aria-modal="true"'));
		assert.ok(html.includes('aria-label="Close settings"'));
		for (const id of ["agents", "agent", "appearance", "keyboard", "general"]) {
			assert.ok(html.includes(`data-testid="settings-nav-${id}"`), id);
		}
		assert.ok(!html.includes('data-testid="settings-nav-providers"'), "no Providers section")
		// Redesign (design/exports/settings.html): Outside agents is the first
		// landing section; the old Graph section's rows live in General.
		assert.ok(tagOf(html, "settings-nav-agents").includes('aria-current="true"'));
		assert.ok(html.indexOf('data-testid="settings-nav-agents"') < html.indexOf('data-testid="settings-nav-general"'));
		assert.ok(!html.includes('data-testid="settings-nav-graph"'));
		assert.ok(html.includes('data-testid="settings-section-title"') && html.includes(">Outside agents</h3>"));
		assert.ok(tagOf(html, "settings-nav-keyboard").includes('aria-current="false"'));
		// Fetches don't run under SSR — the loading state IS the SSR state.
		assert.ok(html.includes("Loading settings…"));
		// Modal-only doctrine: no link back to /settings anywhere in it.
		assert.ok(!html.includes('href="/settings"'));
	});
});

describe("AgentSection (thin SSR)", () => {
	it("renders the Tools and System prompts groups, and no Models group (the outside agent is the only model)", () => {
		const html = renderToStaticMarkup(<AgentSection agent={undefined} graph={undefined} onSectionChange={() => {}} compaction={undefined} onCompactionChange={() => {}} />);
		assert.ok(!html.includes('data-testid="group-models"'), "no Models sub-group");
		assert.ok(!html.includes('data-testid="slot-row-'), "no slot rows");
		assert.ok(html.includes('data-testid="group-tools"'), "Tools sub-group");
		assert.ok(html.includes('data-testid="group-prompts"'), "System prompts sub-group");
	});

	it("no search-engine row (web search was removed)", () => {
		const html = renderToStaticMarkup(<AgentSection agent={undefined} graph={undefined} onSectionChange={() => {}} compaction={undefined} onCompactionChange={() => {}} />);
		assert.ok(!html.includes('data-testid="search-engine-row"'));
	});

	it("the prober graph-tools row: FIRST in the Tools group, default ON, its own key (wave 7)", () => {
		// Default state: graph on, graphTools absent → ON, the describing
		// hint rides.
		const html = renderToStaticMarkup(<AgentSection agent={undefined} graph={undefined} onSectionChange={() => {}} compaction={undefined} onCompactionChange={() => {}} />);
		const toolsGroup = html.split('data-testid="group-tools"')[1] ?? "";
		const rows = [...toolsGroup.matchAll(/data-testid="(graph-tools-row|tool-row-\w+)"/g)].map((m) => m[1]);
		assert.equal(rows[0], "graph-tools-row", "graph tools is the FIRST row of the Tools group");
		// (the apostrophe in "sessions'" HTML-escapes — match up to it)
		assert.ok(html.includes("Lets the tutor consult your knowledge map between sessions"), "the describing hint");
		assert.ok((html.split('data-testid="graph-tools-row"')[1] ?? "").includes('aria-checked="true"'), "absent = on");
		const rowHtml = html.split('data-testid="graph-tools-row"')[1]?.split('data-testid="tool-row-')[0] ?? "";
		assert.ok(!rowHtml.includes("opacity-40"), "lit while the graph is on");
	});

	it("graph disabled dims the graph-tools row with the honest hint (the predicate composes)", () => {
		const html = renderToStaticMarkup(
			<AgentSection agent={undefined} graph={{ enabled: false }} onSectionChange={() => {}} compaction={undefined} onCompactionChange={() => {}} />,
		);
		const row = html.split('data-testid="graph-tools-row"')[1]?.split('data-testid="tool-row-')[0] ?? "";
		assert.ok(row.includes("opacity-40"), "row dims when the graph is off");
		assert.ok(row.includes("Graph is disabled"), "the reason hint replaces the description");
		assert.ok(row.includes("disabled"), "toggle untouchable while the graph is off");
	});

	it("an explicit graphTools off shows stored-off (the record never lies)", () => {
		const html = renderToStaticMarkup(
			<AgentSection agent={{ graphTools: { enabled: false } }} graph={undefined} onSectionChange={() => {}} compaction={undefined} onCompactionChange={() => {}} />,
		);
		const row = html.split('data-testid="graph-tools-row"')[1] ?? "";
		assert.ok(row.includes('aria-checked="false"'), "stored-off renders off");
	});

	it("renders the owner's FINAL tool list — research, demo, visual, pdf", () => {
		assert.deepEqual([...TOGGLE_TOOLS], ["research", "demo", "visual", "pdf"]);
		const html = renderToStaticMarkup(<AgentSection agent={undefined} graph={undefined} onSectionChange={() => {}} compaction={undefined} onCompactionChange={() => {}} />);
		for (const id of TOGGLE_TOOLS) assert.ok(html.includes(`data-testid="tool-row-${id}"`), id);
	});

	it("tools default ON (absent key = enabled)", () => {
		const html = renderToStaticMarkup(<AgentSection agent={undefined} graph={undefined} onSectionChange={() => {}} compaction={undefined} onCompactionChange={() => {}} />);
		for (const id of TOGGLE_TOOLS) {
			assert.ok(tagOf(html, `toggle-tool-${id}`).includes('aria-checked="true"'), `${id} defaults on`);
		}
	});

	it("tools carry the stored delta", () => {
		const html = renderToStaticMarkup(
			<AgentSection
				agent={{ tools: { demo: false } }}
				graph={undefined}
				compaction={undefined}
				onSectionChange={() => {}}
				onCompactionChange={() => {}}
			/>,
		);
		assert.ok(tagOf(html, "toggle-tool-demo").includes('aria-checked="false"'), "demo off");
		assert.ok(tagOf(html, "toggle-tool-visual").includes('aria-checked="true"'), "visual still on");
	});

	it("prompts show the loading state under SSR (effects never fire)", () => {
		const html = renderToStaticMarkup(<AgentSection agent={undefined} graph={undefined} onSectionChange={() => {}} compaction={undefined} onCompactionChange={() => {}} />);
		assert.ok(html.includes("Loading prompt segments"));
	});
});

describe("GraphSection — master switch + chunk budget (wave 7 + 2026-10-02)", () => {
	// Wave 7 (owner ruling 2026-09-23): the section is the master switch —
	// the embedding/clustering/labeling rungs and the BYOK model picker are
	// gone (clustering is the free birth-session partition, labels ARE
	// session names). The chunk budget (2026-10-02) joined as the second and
	// only other control — it denominates the coverage ring and gates the
	// auto-extraction trigger, resolved through the same core resolver the
	// server uses (the 4096-fallback fix).
	it("renders the master-switch row — EXTRACTION since 2026-10-06 (the data channel, renamed when rendering split off)", () => {
		const html = renderToStaticMarkup(<GraphSection graph={undefined} onSectionChange={() => {}} />);
		assert.ok(html.includes('data-testid="graph-row-enabled"'));
		assert.ok(html.includes(">Extraction<"), "the row names the DATA channel, not 'Graph'");
		assert.ok(!html.includes("graph-row-embedding"), "the dead rungs render nothing");
		assert.ok(!html.includes("Embedding model"), "the picker is gone");
		assert.ok(!html.includes("graph-row-clustering"));
		assert.ok(!html.includes("graph-row-labeling"));
		assert.ok(tagOf(html, "toggle-extraction-enabled").includes('aria-checked="true"'), "absent record = factory ON");
	});

	it("a stored off record shows the extraction switch off", () => {
		const html = renderToStaticMarkup(<GraphSection graph={{ enabled: false }} onSectionChange={() => {}} />);
		assert.ok(tagOf(html, "toggle-extraction-enabled").includes('aria-checked="false"'));
	});

	it("no Graph rendering row (removed with the old fact canvas, 2026-10-27)", () => {
		const html = renderToStaticMarkup(<GraphSection graph={undefined} onSectionChange={() => {}} />);
		assert.ok(!html.includes('data-testid="graph-row-rendering"'));
		assert.ok(!html.includes("Graph rendering"));
	});

	it("the chunk-budget row: unset shows EMPTY with the factory placeholder + hint — one truth with the trigger", () => {
		const html = renderToStaticMarkup(<GraphSection graph={undefined} onSectionChange={() => {}} />);
		const input = tagOf(html, "input-chunk-tokens");
		assert.ok(input.includes('placeholder="4096"'), "the placeholder IS the resolved factory default");
		assert.ok(!/value="\d/.test(input), "unset renders EMPTY, not a materialized 4096");
		assert.ok(html.includes(">4096 tok</"), "the hint reports the resolved truth");
	});

	it("a stored budget shows its value and denominates the hint", () => {
		const html = renderToStaticMarkup(
			<GraphSection graph={{ enabled: true, extractionChunkTokens: 6000 }} onSectionChange={() => {}} />,
		);
		assert.ok(tagOf(html, "input-chunk-tokens").includes('value="6000"'));
		assert.ok(html.includes(">6000 tok</"));
	});
});

describe("AppearanceSection (thin SSR)", () => {
	it("mode is rendered DISABLED — dark-only this wave, no lying control", () => {
		const html = renderToStaticMarkup(<AppearanceSection appearance={undefined} onSectionChange={() => {}} />);
		assert.ok(tagOf(html, "select-mode").includes("disabled"), "mode select disabled");
		assert.ok(html.includes("Coming soon"));
		// The whole row dims, graph-view style (the control never adds its own).
		assert.ok(tagOf(html, "row-mode").includes("opacity-40"), "mode row dims whole");
	});

	it("hex inputs carry the factory placeholders; prose size resolves against the factory", () => {
		const html = renderToStaticMarkup(<AppearanceSection appearance={undefined} onSectionChange={() => {}} />);
		assert.ok(html.includes(`placeholder="#141414"`));
		// The reading font is the searchable dropdown now (font-menu
		// wave): its trigger shows the factory family; the emphasis
		// inks' empty state is "same as text" (the old hexes died with
		// the factory token change).
		assert.ok(html.includes('data-testid="font-trigger"'));
		assert.equal((html.match(/Empty = same as text/g) ?? []).length, 2);
		assert.ok(html.includes("16px"));
	});

	it("a set background shows in the input, not the placeholder", () => {
		const html = renderToStaticMarkup(
			<AppearanceSection appearance={{ background: "#1a1a2e" }} onSectionChange={() => {}} />,
		);
		assert.ok(html.includes(`value="#1a1a2e"`));
	});
});

describe("KeyboardSection (thin SSR)", () => {
	it("renders every registry action in its scope group", () => {
		const html = renderToStaticMarkup(<KeyboardSection />);
		for (const def of KEYBOARD_ACTIONS) {
			assert.ok(html.includes(`data-testid="kbd-row-${def.id}"`), def.id);
		}
		assert.ok(html.includes("kbd-scope-global"));
		assert.ok(html.includes("kbd-scope-chat"));
	});

	it("open-settings is in the registry with the settings chord", () => {
		const def = KEYBOARD_ACTIONS.find((a) => a.id === "open-settings");
		assert.ok(def, "the action exists");
		assert.equal(def?.scope, "global");
		assert.equal(def?.binding, "mod+,");
	});

	it("displayOnly actions list but never offer Rebind", () => {
		const html = renderToStaticMarkup(<KeyboardSection />);
		assert.ok(html.includes("Fixed — part of this screen"));
		assert.ok(!html.includes(`data-testid="kbd-rebind-question-next-row"`), "surface keys stay put");
		// The model-menu entries are GONE entirely (owner, 2026-10-10):
		// obvious in-field navigation, not settings material.
		assert.ok(!html.includes("Model menu"), "model-menu rows removed");
		assert.ok(!KEYBOARD_ACTIONS.some((a) => a.id as string === "model-menu-walk"));
		assert.ok(!KEYBOARD_ACTIONS.some((a) => a.id as string === "model-menu-pick"));
	});
});