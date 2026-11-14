/**
 * Settings render tests: SSR of the page frame and each section. Fetches
 * don't run under renderToStaticMarkup (effects never fire), so the SSR
 * state is the loading state.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { parseHTML } from "linkedom";
import { renderToStaticMarkup } from "react-dom/server";
import { AreaDetail } from "../../src/frontend/components/settings/area-detail.tsx";
import { TeachingSection } from "../../src/frontend/components/settings/teaching-section.tsx";
import { AppearanceSection } from "../../src/frontend/components/settings/appearance-section.tsx";
import { GeneralSection } from "../../src/frontend/components/settings/general-section.tsx";
import { sectionFor, SettingsPage } from "../../src/frontend/components/settings/settings-page.tsx";
import { ServerEventsProvider } from "../../src/frontend/components/server-events.tsx";

const quietEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });
import { TEACHING_AREAS, type UserSettings } from "../../src/shared/core/index.ts";

/** The full opening tag of the element carrying a testid — attribute
 *  order in React output is not contractual, so assertions run on the
 *  whole tag instead of ordered regex chains. */
function tagOf(html: string, testid: string): string {
	const i = html.indexOf(`data-testid="${testid}"`);
	assert.ok(i >= 0, `missing ${testid}`);
	return html.slice(html.lastIndexOf("<", i), html.indexOf(">", i) + 1);
}

describe("the Settings page (SSR)", () => {
	const page = (section?: string) =>
		renderToStaticMarkup(
			<ServerEventsProvider connect={quietEvents as never}>
				<SettingsPage section={section} />
			</ServerEventsProvider>,
		);

	it("a page, not a dialog: \"Settings\", then one tab per section, Connection first and General last", () => {
		const html = page();
		assert.ok(html.includes(">Settings</h1>"));
		assert.ok(!html.includes('role="dialog"'));
		assert.ok(!html.includes("settings-close"), "nothing to close");
		const ids = [...html.matchAll(/data-testid="settings-nav-(\w+)"/g)].map((m) => m[1]);
		assert.deepEqual(ids, ["connection", "teaching", "appearance", "general"], "no Keyboard tab");
		assert.ok(tagOf(html, "settings-nav-connection").includes('aria-current="true"'));
		assert.ok(tagOf(html, "settings-nav-general").includes('aria-current="false"'));
		// Fetches don't run under SSR: the loading state is the SSR state.
		assert.ok(html.includes("Loading settings…"));
	});

	it("opens on the section the address asks for; an unknown one, the old Keyboard included, lands on Connection", () => {
		assert.ok(tagOf(page("general"), "settings-nav-general").includes('aria-current="true"'));
		assert.equal(sectionFor("keyboard"), "connection");
		assert.equal(sectionFor("teaching"), "teaching");
		assert.equal(sectionFor("nope"), "connection");
		assert.equal(sectionFor(undefined), "connection");
	});
});

describe("TeachingSection (SSR)", () => {
	const render = (props: Partial<React.ComponentProps<typeof TeachingSection>> = {}) =>
		renderToStaticMarkup(
			<ServerEventsProvider connect={quietEvents as never}>
				<TeachingSection agent={undefined} graph={undefined} onGraphChange={() => {}} teacherName="Ada" onSectionChange={() => {}} onFullPage={() => {}} {...props} />
			</ServerEventsProvider>,
		);

	it("a list of the teaching areas in order then Remembered, with the first area's sheet beside it", () => {
		const html = render();
		const ids = [...html.matchAll(/<button[^>]*data-testid="area-([a-z]+)"/g)].map((m) => m[1]);
		assert.deepEqual(ids, [...TEACHING_AREAS.map((a) => a.id), "remembered"]);
		assert.ok(tagOf(html, `area-${TEACHING_AREAS[0]!.id}`).includes('aria-current="true"'), "the first area is picked");
		assert.ok(html.includes('data-testid="area-detail"'));
		assert.ok(html.includes("How Ada teaches you."), "the teacher's name in the lead line");
	});

	it("the picked area's Full instructions button waits disabled until the texts load", () => {
		assert.ok(tagOf(render(), `area-${TEACHING_AREAS[0]!.id}-instructions`).includes("disabled"));
	});

	it("stored rules show as chips in their area", () => {
		const html = render({ agent: { rules: { voice: ["No jokes"] } } });
		assert.ok(html.includes("No jokes"));
		assert.ok(html.includes('data-testid="rules-voice-input"'));
	});
});

describe("AreaDetail (SSR)", () => {
	const area = (id: string) => TEACHING_AREAS.find((a) => a.id === id)!;
	const render = (id: string, props: Partial<React.ComponentProps<typeof AreaDetail>> = {}) =>
		renderToStaticMarkup(
			<ServerEventsProvider connect={quietEvents as never}>
				<AreaDetail
					area={area(id)}
					agent={undefined}
					graphOn
					onGraphChange={() => {}}
					teacherName="Ada"
					savedAt={{}}
					edited={false}
					instructionsReady
					onSectionChange={() => {}}
					onOpenInstructions={() => {}}
					{...props}
				/>
			</ServerEventsProvider>,
		);

	it("switches default on (absent key = on) and carry the stored delta", () => {
		const on = { facts: ["web-search", "build-the-graph-from-lessons", "your-graph"], demos: ["demos", "figures"], files: ["pdf-reading"] } as const;
		for (const [id, toggles] of Object.entries(on)) {
			const html = render(id);
			for (const t of toggles) assert.ok(tagOf(html, `toggle-${t}`).includes('aria-checked="true"'), t);
		}
		const off = render("demos", { agent: { tools: { demo: false } } });
		assert.ok(tagOf(off, "toggle-demos").includes('aria-checked="false"'));
		assert.ok(tagOf(off, "toggle-figures").includes('aria-checked="true"'));
		assert.ok(tagOf(render("facts", { agent: { graphTools: { enabled: false } } }), "toggle-your-graph").includes('aria-checked="false"'));
	});

	it("quiz style: multiple choice by default, free recall when explain is on", () => {
		assert.ok(tagOf(render("questions"), "quiz-style-choice").includes('aria-checked="true"'));
		const free = render("questions", { agent: { tools: { explain: true } } });
		assert.ok(tagOf(free, "quiz-style-free").includes('aria-checked="true"'));
		assert.ok(tagOf(free, "quiz-style-choice").includes('aria-checked="false"'));
	});

	it("Facts and research holds the graph's own switch; Your graph shows only while it is on", () => {
		const off = render("facts", { graphOn: false });
		assert.ok(tagOf(off, "toggle-build-the-graph-from-lessons").includes('aria-checked="false"'));
		assert.ok(!off.includes("toggle-your-graph"), "no dimmed row that does nothing");
		assert.ok(tagOf(render("facts", { graphOn: true }), "toggle-build-the-graph-from-lessons").includes('aria-checked="true"'));
		assert.ok(render("facts", { graphOn: true }).includes('data-testid="toggle-your-graph"'));
	});

	it("one Web search: the switch, and while it is on, who searches under it", () => {
		const on = render("facts");
		assert.ok(on.includes('data-testid="toggle-web-search"'));
		assert.ok(!on.includes("Web research"));
		assert.ok(on.indexOf('data-testid="toggle-web-search"') < on.indexOf('data-testid="web-search"'), "who searches sits under the switch");
		const off = render("facts", { agent: { tools: { research: false } } });
		assert.ok(!off.includes('data-testid="web-search"'), "nothing to pick while nobody searches");
	});

	it("an area with its own instructions changed says so", () => {
		assert.ok(render("voice", { edited: true }).includes("You changed these."));
		assert.ok(!render("voice").includes("You changed these."));
	});
});

describe("GeneralSection (SSR)", () => {
	const render = (record: UserSettings) =>
		renderToStaticMarkup(
			<GeneralSection record={record} onGeneralChange={() => {}} />,
		);

	it("teacher name and sounds, with no sliders and no graph switch", () => {
		const html = render({ version: 1 });
		assert.ok(tagOf(html, "teacher-name").includes('placeholder="Teacher"'));
		assert.doesNotMatch(html, /slider-|Summarize long lessons|Add to the graph|toggle-build-the-graph/);
		assert.match(html, /<span class="block text-base text-ink-2">Shown in the window only</, "hints use the readable quiet color");
	});

	it("a switch says On or Off beside its track", () => {
		const on = render({ version: 1 });
		assert.match(on.split('data-testid="toggle-sounds"')[1]!.slice(0, 400), />On</);
		const off = render({ version: 1, general: { sounds: false } });
		assert.match(off.split('data-testid="toggle-sounds"')[1]!.slice(0, 400), />Off</);
	});

	it("deadline reminders: on by default, off when the record says so, only in the desktop app", () => {
		assert.ok(!render({ version: 1 }).includes("deadline-reminders-row"), "a browser can show no notification");
		const global = globalThis as { window?: unknown };
		global.window = { lh: {} };
		try {
			const on = render({ version: 1 });
			assert.ok(on.includes("One notification a day when a deadline is 3 days away or less<"));
			assert.ok(tagOf(on, "toggle-deadline-reminders").includes('aria-checked="true"'));
			const off = render({ version: 1, general: { deadlineReminders: false } });
			assert.ok(tagOf(off, "toggle-deadline-reminders").includes('aria-checked="false"'));
		} finally {
			delete global.window;
		}
	});
});

describe("AppearanceSection (SSR)", () => {
	it("the background presets plus Custom, with Paper picked at factory", () => {
		const html = renderToStaticMarkup(<AppearanceSection appearance={undefined} onSectionChange={() => {}} />);
		for (const id of ["paper", "night", "black", "graphite", "midnight", "forest", "custom"]) {
			assert.ok(html.includes(`data-testid="theme-${id}"`), id);
		}
		assert.ok(tagOf(html, "theme-paper").includes('aria-pressed="true"'));
		assert.ok(html.includes('data-testid="font-trigger"'));
		assert.ok(tagOf(html, "slider-text-size").includes('value="17"'));
		assert.ok(html.includes('data-testid="appearance-preview"'));
		assert.doesNotMatch(html, /Heading weight|Bold and italic|slider-heading-weight/);
	});

	it("Tab onto a hidden color picker rings its visible tile", () => {
		const css = fs.readFileSync("src/frontend/globals.css", "utf-8");
		assert.ok(css.includes(':root[data-tab-focus] :has(> input[type="color"]:focus-visible)'), "the ring rule for a picker's tile");
		const html = renderToStaticMarkup(<AppearanceSection appearance={undefined} onSectionChange={() => {}} />);
		const pickers = [...parseHTML(`<div>${html}</div>`).document.querySelectorAll('input[type="color"]')];
		assert.equal(pickers.length, 1, "the custom background's");
		for (const input of pickers) {
			assert.match(input.className, /opacity-0/, "the picker itself is invisible");
			assert.match(input.parentElement!.className, /\bborder\b/, `${input.getAttribute("aria-label")} sits right in its tile`);
		}
	});
});
