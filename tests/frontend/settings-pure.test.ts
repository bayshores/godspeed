/**
 * The settings pure layers: the appearance → CSS-variable mapping, the
 * background-derived palette (dark and light), the Teaching section's
 * compose helpers (the replace-whole PUT), and the keyboard overrides map.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
	appearanceVars,
	BACKGROUND_PRESETS,
	derivedPalette,
	readableBackground,
	resolveAppearance,
	staleVarNames,
} from "../../src/frontend/components/settings/appearance-model.ts";
import { contrast } from "../../src/shared/core/ink.ts";
import {
	areaParts,
	composeGraphTools,
	composeQuizStyle,
	composeRules,
	composeTool,
} from "../../src/frontend/components/settings/teaching-model.ts";
import { nextOverrides } from "../../src/frontend/components/settings/keyboard-section.tsx";
import { TEACHING_AREAS, type AgentSettings, type PromptSegmentInfo } from "../../src/shared/core";

describe("resolveAppearance — delta over factory", () => {
	it("absent everything = the factory view", () => {
		const a = resolveAppearance(undefined);
		assert.equal(a.background, null);
		assert.equal(a.fontFamily, null);
		assert.equal(a.proseFontSize, 16);
		assert.equal(a.sessionNameSerif, true);
		assert.deepEqual(a.mdRendering, { headingWeight: 900, boldColor: null, italicColor: null });
	});

	it("explicit deltas win field-by-field", () => {
		const a = resolveAppearance({ proseFontSize: 20, fontFamily: "Iowan Old Style" });
		assert.equal(a.proseFontSize, 20);
		assert.equal(a.fontFamily, "Iowan Old Style");
		assert.equal(a.background, null);
	});
});

describe("derivedPalette — every surface and text color follows the background", () => {
	it("a dark background steps surfaces up and keeps light text", () => {
		const p = derivedPalette("#141414");
		assert.equal(p["color-scheme"], "dark");
		assert.equal(p["--background"], "#141414");
		assert.equal(p["--card"], "#1c1c1c");
		assert.equal(p["--accent"], "#2a2a2a");
		assert.equal(p["--lh-tip"], "#282828");
		assert.equal(p["--border"], "#434343");
		assert.equal(p["--foreground"], "#e6e6e6");
		assert.equal(p["--primary-foreground"], "#141414", "primary buttons take the background as their text");
		assert.equal(p["--lh-ink-max"], "#ffffff");
	});

	it("OLED black derives the redesign's panel / tone / tooltip / tone-2", () => {
		const p = derivedPalette("#000000");
		assert.equal(p["--card"], "#080808");
		assert.equal(p["--accent"], "#161616");
		assert.equal(p["--lh-tip"], "#141414");
		assert.equal(p["--border"], "#2f2f2f");
	});

	it("a light background steps surfaces down and flips the text to dark", () => {
		const p = derivedPalette("#f4f1ea");
		assert.equal(p["color-scheme"], "light");
		assert.equal(p["--card"], "#ece9e2");
		assert.equal(p["--border"], "#c5c2bb");
		assert.equal(p["--foreground"], "#1c1a15", "dark text with a hint of the paper's warmth");
		assert.equal(p["--lh-ink-max"], "#000000");
		assert.equal(p["--primary-foreground"], "#f4f1ea");
	});

	it("channels clamp at 255", () => {
		assert.equal(derivedPalette("#0000ff")["--card"], "#0808ff");
	});

	it("a mid color takes the text that reads better: dark on red and orange", () => {
		for (const bg of ["#ff0000", "#e07020"]) {
			const p = derivedPalette(bg);
			assert.equal(p["color-scheme"], "light", bg);
			assert.equal(p["--foreground"], "#000000", bg);
		}
	});

	it("3-digit hex expands", () => {
		assert.equal(derivedPalette("#123")["--card"], "#192a3b"); // 11 22 33 each +8
	});

	it("black's palette is the stylesheet's default", () => {
		const css = fs.readFileSync("src/app/globals.css", "utf-8");
		const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
		const declared = new Map([...root.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
		// The shadcn aliases the stylesheet leaves out fall back on their own; every lh token is declared.
		const palette = Object.entries(derivedPalette("#000000")).filter(([name]) => name.startsWith("--lh-") || declared.has(name));
		for (const [name, value] of palette) assert.equal(declared.get(name), value, name);
	});

	it("on every preset, text reads at 4.5, the status colors read as text and edges show at 3", () => {
		for (const { name, color } of BACKGROUND_PRESETS) {
			const p = derivedPalette(color ?? "#000000");
			const surfaces = [p["--background"]!, p["--card"]!, p["--accent"]!];
			const min = (ink: string, on: readonly string[]) => Math.min(...on.map((s) => contrast(ink, s)));
			for (const level of ["--foreground", "--lh-ink-body", "--muted-foreground"]) {
				assert.ok(min(p[level]!, [...surfaces, p["--lh-tip-hover"]!]) >= 4.5, `${name} ${level}`);
			}
			assert.ok(min(p["--lh-ink-3"]!, surfaces) >= 4.5, `${name} ink-3`);
			for (const status of Object.keys(p).filter((k) => /^--(lh-(ans|conf|ramp)-|destructive)/.test(k))) {
				assert.ok(min(p[status]!, surfaces) >= 4.5, `${name} ${status}`);
				assert.ok(contrast(p["--background"]!, p[status]!) >= 4.5, `${name} text-background on a ${status} fill`);
			}
			assert.ok(min(p["--lh-edge"]!, [p["--background"]!, p["--card"]!]) >= 3, `${name} edge`);
		}
	});
});

describe("readableBackground — a picked color text can't read on is moved until it can", () => {
	it("leaves every preset alone", () => {
		for (const { color } of BACKGROUND_PRESETS) if (color) assert.equal(readableBackground(color), color);
	});

	it("moves a mid color toward its text's opposite until secondary text reads on its tone", () => {
		for (const picked of ["#777777", "#3366cc", "#ff0000"]) {
			const bg = readableBackground(picked);
			assert.notEqual(bg, picked, picked);
			const p = derivedPalette(bg);
			assert.ok(contrast(p["--muted-foreground"]!, p["--accent"]!) >= 4.5, `${picked} → ${bg}`);
		}
		assert.ok(contrast("#000000", readableBackground("#777777")) > contrast("#000000", "#777777"), "gray (dark text) gets lighter");
		assert.ok(contrast("#ffffff", readableBackground("#3366cc")) > contrast("#ffffff", "#3366cc"), "blue (light text) gets darker");
	});

	it("is what appearanceVars paints (the saved choice stays as picked)", () => {
		const vars = appearanceVars(resolveAppearance({ background: "#777777" }));
		assert.equal(vars["--background"], readableBackground("#777777"));
	});
});

describe("appearanceVars — the mapping the provider applies", () => {
	it("factory appearance: only the always-applied tokens move", () => {
		const vars = appearanceVars(resolveAppearance(undefined));
		assert.equal(vars["--lh-prose-size"], "16px");
		assert.equal(vars["--lh-heading-weight"], "900");
		assert.equal(vars["--font-prose"], undefined, "no font override at factory");
		assert.equal(vars["--font-title"], undefined, "CMU stays");
		assert.equal(vars["--background"], undefined, "factory palette untouched");
		assert.equal(vars["--lh-ink-strong"], undefined, "default ink");
	});

	it("full delta: every knob lands on its token", () => {
		const vars = appearanceVars(
			resolveAppearance({
				background: "#101820",
				fontFamily: "Georgia",
				proseFontSize: 18,
				sessionNameSerif: false,
				mdRendering: { headingWeight: 700, boldColor: "#ff8080", italicColor: "#00ff00" },
			}),
		);
		assert.equal(vars["--background"], "#101820");
		assert.equal(vars["--card"], "#182028", "raised +8 per channel: 10→18, 18→20, 20→28");
		assert.equal(vars["--font-prose"], `"Georgia", var(--font-sans3), ui-sans-serif, system-ui, sans-serif`);
		assert.equal(vars["--lh-prose-size"], "18px");
		assert.equal(vars["--font-title"], "var(--font-prose)", "serif off → titles follow the prose font");
		assert.equal(vars["--lh-heading-weight"], "700");
		assert.equal(vars["--lh-ink-strong"], "#ff8080");
		assert.equal(vars["--lh-ink-italic"], "#00ff00");
	});

	it("a bold color that would be hard to read is made readable", () => {
		const vars = appearanceVars(resolveAppearance({ mdRendering: { boldColor: "#2f5fb3" } }));
		assert.notEqual(vars["--lh-ink-strong"], "#2f5fb3", "dark blue on black is lightened");
	});

	it("sessionNameSerif false alone: titles move, nothing else does", () => {
		const vars = appearanceVars(resolveAppearance({ sessionNameSerif: false }));
		assert.equal(vars["--font-title"], "var(--font-prose)");
		assert.equal(Object.keys(vars).length, 3, "prose-size, heading-weight, font-title only");
	});
});

describe("staleVarNames — the removal half of application (resets revert)", () => {
	it("a full delta applied, then factory: every delta-only name goes stale", () => {
		const fullDelta = appearanceVars(
			resolveAppearance({
				background: "#101820",
				fontFamily: "Georgia",
				sessionNameSerif: false,
				mdRendering: { headingWeight: 700, boldColor: "#ff8080", italicColor: "#00ff00" },
			}),
		);
		const applied = Object.keys(fullDelta);
		const factory = appearanceVars(resolveAppearance(undefined));
		const stale = staleVarNames(applied, factory);
		assert.ok(stale.includes("--background"));
		assert.ok(stale.includes("--font-prose"));
		assert.ok(stale.includes("--font-title"), "serif toggle back ON must clear the title override");
		assert.ok(stale.includes("--lh-ink-strong"));
		assert.ok(stale.includes("--lh-ink-italic"));
		assert.ok(!stale.includes("--lh-prose-size"), "always-applied tokens never go stale");
		assert.ok(!stale.includes("--lh-heading-weight"), "always-applied tokens never go stale");
	});

	it("an empty background commit (null = factory) frees the palette vars", () => {
		const withBg = appearanceVars(resolveAppearance({ background: "#101010" }));
		const emptied = appearanceVars(resolveAppearance({ background: null }));
		const stale = staleVarNames(Object.keys(withBg), emptied);
		assert.ok(stale.includes("--background"));
		assert.ok(stale.includes("--card"), "the derived palette follows the background out");
		assert.equal(emptied["--background"], undefined);
	});

	it("no previous applications → nothing stale", () => {
		assert.deepEqual(staleVarNames([], appearanceVars(resolveAppearance(undefined))), []);
	});
});

describe("Teaching compose helpers — the replace-whole PUT body", () => {
	const before: AgentSettings = { tools: { demo: false }, rules: { voice: ["No jokes"] }, graphTools: { enabled: true } };

	it("composeTool sets one tool and carries the rest verbatim", () => {
		const after = composeTool(before, "visual", false);
		assert.deepEqual(after.tools, { demo: false, visual: false });
		assert.deepEqual(after.rules, before.rules);
		assert.deepEqual(after.graphTools, before.graphTools);
	});

	it("composeQuizStyle: free recall writes explain:true, multiple choice explain:false", () => {
		assert.equal(composeQuizStyle(before, "free").tools?.explain, true);
		assert.equal(composeQuizStyle(before, "choice").tools?.explain, false);
		assert.equal(composeQuizStyle(before, "free").tools?.demo, false, "other tools carry over");
	});

	it("composeGraphTools replaces only the graph-tools switch", () => {
		const after = composeGraphTools(before, false);
		assert.deepEqual(after.graphTools, { enabled: false });
		assert.deepEqual(after.tools, before.tools);
	});

	it("composeRules replaces one area; an emptied area is dropped", () => {
		const added = composeRules(before, "facts", ["Cite the textbook"]);
		assert.deepEqual(added.rules, { voice: ["No jokes"], facts: ["Cite the textbook"] });
		assert.deepEqual(composeRules(added, "voice", []).rules, { facts: ["Cite the textbook"] });
		assert.deepEqual(composeRules(undefined, "voice", ["Short answers"]).rules, { voice: ["Short answers"] });
	});

	it("areaParts keeps the area's order and skips parts the prompt doesn't have", () => {
		const area = TEACHING_AREAS.find((a) => a.id === "facts");
		assert.ok(area);
		const seg = (path: string): PromptSegmentInfo => ({ path, sourceText: "", overrideText: null, shared: true });
		const segments = [seg("teacher/40-jobs.md"), seg("shared/15-accuracy.md"), seg("shared/10-voice.md")];
		assert.deepEqual(
			areaParts(area, segments).map((s) => s.path),
			["shared/15-accuracy.md", "teacher/40-jobs.md"],
		);
	});
});

describe("nextOverrides — the rebind persistence map", () => {
	it("a rebind sets the action's override, keeping the others", () => {
		const next = nextOverrides({ "toggle-sidebar": "mod+b" }, "open-settings", "mod+shift+s");
		assert.deepEqual(next, { "toggle-sidebar": "mod+b", "open-settings": "mod+shift+s" });
	});

	it("null = reset that action to its default (key removed)", () => {
		const next = nextOverrides({ "toggle-sidebar": "mod+b", find: "mod+f" }, "toggle-sidebar", null);
		assert.deepEqual(next, { find: "mod+f" });
	});
});
