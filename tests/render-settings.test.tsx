/**
 * Settings-surface render tests: SSR of the dialog frame and each section.
 * Fetches don't run under renderToStaticMarkup (effects never fire), so the
 * SSR state is the loading state. Same tsx classic-JSX shim as
 * render-sidebar.test.tsx.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { parseHTML } from "linkedom";
import { renderToStaticMarkup } from "react-dom/server";
import { TeachingSection } from "../src/components/settings/teaching-section.tsx";
import { AppearanceSection } from "../src/components/settings/appearance-section.tsx";
import { GeneralSection } from "../src/components/settings/general-section.tsx";
import { KeyboardSection } from "../src/components/settings/keyboard-section.tsx";
import { SettingsDialogBody } from "../src/components/settings/settings-dialog.tsx";
import { SettingsDialogProvider } from "../src/components/settings/settings-dialog-provider.tsx";
import { KEYBOARD_ACTIONS, TEACHING_AREAS, type UserSettings } from "../src/core/index.ts";

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

	it("the dialog frame: role=dialog + the ✕ + the five-section nav, Connection first and General last", () => {
		const html = renderToStaticMarkup(<SettingsDialogBody onClose={() => {}} />);
		assert.ok(html.includes('role="dialog"'));
		assert.ok(html.includes('aria-modal="true"'));
		assert.ok(html.includes('aria-label="Close settings"'));
		const ids = [...html.matchAll(/data-testid="settings-nav-(\w+)"/g)].map((m) => m[1]);
		assert.deepEqual(ids, ["connection", "teaching", "appearance", "keyboard", "general"]);
		assert.ok(tagOf(html, "settings-nav-connection").includes('aria-current="true"'));
		assert.ok(html.includes('data-testid="settings-section-title"') && html.includes(">Connection</h3>"));
		assert.ok(tagOf(html, "settings-nav-keyboard").includes('aria-current="false"'));
		// Fetches don't run under SSR — the loading state IS the SSR state.
		assert.ok(html.includes("Loading settings…"));
		// Modal-only: no link back to /settings anywhere in it.
		assert.ok(!html.includes('href="/settings"'));
	});
});

describe("TeachingSection (SSR)", () => {
	const render = (props: Partial<React.ComponentProps<typeof TeachingSection>> = {}) =>
		renderToStaticMarkup(
			<TeachingSection agent={undefined} graph={undefined} teacherName="Halley" onSectionChange={() => {}} {...props} />,
		);

	it("one card per teaching area, in order, each with rules and a Full instructions button", () => {
		const html = render();
		const ids = [...html.matchAll(/data-testid="area-(\w+)"/g)].map((m) => m[1]);
		assert.deepEqual(ids, TEACHING_AREAS.map((a) => a.id));
		for (const area of TEACHING_AREAS) {
			assert.ok(html.includes(`data-testid="rules-${area.id}-add"`), `${area.id} rules`);
			// Segments load in an effect, so the button waits disabled under SSR.
			assert.ok(tagOf(html, `area-${area.id}-instructions`).includes("disabled"), `${area.id} instructions`);
		}
		assert.ok(html.includes("How Halley teaches you."), "the teacher's name in the lead line");
	});

	it("switches default on (absent key = on) and carry the stored delta", () => {
		const html = render();
		for (const id of ["web-research", "your-graph", "demos", "figures", "pdf-reading"]) {
			assert.ok(tagOf(html, `toggle-${id}`).includes('aria-checked="true"'), id);
		}
		const off = render({ agent: { tools: { demo: false }, graphTools: { enabled: false } } });
		assert.ok(tagOf(off, "toggle-demos").includes('aria-checked="false"'));
		assert.ok(tagOf(off, "toggle-figures").includes('aria-checked="true"'));
		assert.ok(tagOf(off, "toggle-your-graph").includes('aria-checked="false"'));
	});

	it("the graph switch is disabled, with the reason, while building the graph is off", () => {
		const html = render({ graph: { enabled: false } });
		assert.ok(tagOf(html, "toggle-your-graph").includes("disabled"));
		assert.ok(html.includes("Off while building the graph is off in General"));
	});

	it("quiz style: multiple choice by default, free recall when explain is on", () => {
		assert.ok(tagOf(render(), "quiz-style-choice").includes('aria-checked="true"'));
		const free = render({ agent: { tools: { explain: true } } });
		assert.ok(tagOf(free, "quiz-style-free").includes('aria-checked="true"'));
		assert.ok(tagOf(free, "quiz-style-choice").includes('aria-checked="false"'));
	});

	it("stored rules show as chips in their area", () => {
		const html = render({ agent: { rules: { voice: ["No jokes"] } } });
		const voice = html.split('data-testid="area-voice"')[1]?.split('data-testid="area-teaching"')[0] ?? "";
		assert.ok(voice.includes("No jokes"));
	});
});

describe("GeneralSection (SSR)", () => {
	const render = (record: UserSettings) =>
		renderToStaticMarkup(
			<GeneralSection record={record} onGeneralChange={() => {}} onCompactionChange={() => {}} onGraphChange={() => {}} />,
		);

	it("teacher name, the two sliders at their factory values, and the graph switch", () => {
		const html = render({ version: 1 });
		assert.ok(tagOf(html, "teacher-name").includes('placeholder="Halley"'));
		assert.ok(tagOf(html, "slider-compaction").includes('value="40000"'));
		assert.ok(html.includes("about 80 pages"), "lesson length in pages, not tokens");
		assert.ok(!html.includes("k tokens"));
		assert.ok(tagOf(html, "slider-chunk-tokens").includes('value="4096"'));
		assert.ok(tagOf(html, "toggle-build-the-graph").includes('aria-checked="true"'));
		assert.match(html, /<span class="block text-xs text-ink-2">Shown in the window only</, "hints use the readable quiet color");
	});

	it("graph off: the switch shows off and the chunk slider is disabled", () => {
		const html = render({ version: 1, graph: { enabled: false, extractionChunkTokens: 6000 } });
		assert.ok(tagOf(html, "toggle-build-the-graph").includes('aria-checked="false"'));
		const slider = tagOf(html, "slider-chunk-tokens");
		assert.ok(slider.includes('value="6000"') && slider.includes("disabled"));
		assert.ok(html.includes("about 12 pages"));
	});
});

describe("AppearanceSection (SSR)", () => {
	it("the background presets plus Custom, with Black picked at factory", () => {
		const html = renderToStaticMarkup(<AppearanceSection appearance={undefined} onSectionChange={() => {}} />);
		for (const id of ["black", "graphite", "midnight", "forest", "paper", "white", "custom"]) {
			assert.ok(html.includes(`data-testid="theme-${id}"`), id);
		}
		assert.ok(tagOf(html, "theme-black").includes('aria-pressed="true"'));
		assert.ok(html.includes('data-testid="font-trigger"'));
		assert.ok(tagOf(html, "slider-text-size").includes('value="16"'));
		assert.ok(html.includes('data-testid="appearance-preview"'));
	});

	it("a light background offers the light bold colors", () => {
		const html = renderToStaticMarkup(<AppearanceSection appearance={{ background: "#f4f1ea" }} onSectionChange={() => {}} />);
		assert.ok(tagOf(html, "theme-paper").includes('aria-pressed="true"'));
		assert.ok(html.includes('aria-label="#b4541e"'));
		assert.ok(!html.includes('aria-label="#f2c14e"'));
	});

	it("Tab onto a hidden color picker rings its visible tile", () => {
		const css = fs.readFileSync("src/app/globals.css", "utf-8");
		assert.ok(css.includes(':root[data-tab-focus] :has(> input[type="color"]:focus-visible)'), "the ring rule for a picker's tile");
		const html = renderToStaticMarkup(<AppearanceSection appearance={undefined} onSectionChange={() => {}} />);
		const pickers = [...parseHTML(`<div>${html}</div>`).document.querySelectorAll('input[type="color"]')];
		assert.equal(pickers.length, 2);
		for (const input of pickers) {
			assert.match(input.className, /opacity-0/, "the picker itself is invisible");
			assert.match(input.parentElement!.className, /\bborder\b/, `${input.getAttribute("aria-label")} sits right in its tile`);
		}
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
		assert.ok(html.includes("Fixed, part of this screen"));
		assert.ok(!html.includes(`data-testid="kbd-rebind-question-next-row"`), "surface keys stay put");
		// The model-menu entries are GONE entirely (owner, 2026-10-10):
		// obvious in-field navigation, not settings material.
		assert.ok(!html.includes("Model menu"), "model-menu rows removed");
		assert.ok(!KEYBOARD_ACTIONS.some((a) => a.id as string === "model-menu-walk"));
		assert.ok(!KEYBOARD_ACTIONS.some((a) => a.id as string === "model-menu-pick"));
	});
});