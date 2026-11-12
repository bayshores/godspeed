// The pure record rules (settings, teaching rules, agent notes/rules/seen, prompt segment paths,
// changelog versions) on inputs that probe each branch.
import { CHANGELOG, compareVersions, entriesSince, entryFor, isVersion } from "../../../../src/shared/core/changelog.ts";
import { parseAgentNotes, cleanNoteText } from "../../../../src/shared/core/agent-notes.ts";
import { parseSavedRules, parseWhere, ruleFor, sameWhere, whereLabel } from "../../../../src/shared/core/agent-rules.ts";
import { parseAgentSeen, seenMark, withSeen } from "../../../../src/shared/core/agent-seen.ts";
import { isValidSegmentPath } from "../../../../src/shared/core/prompt-segments.ts";
import { graphToolsEnabled, resolveSettings } from "../../../../src/shared/core/settings-resolution.ts";
import { isHexColor, sanitizeTeacherName, sanitizeUserSettings } from "../../../../src/shared/core/settings.ts";
import { learnerRulesSection, oneLine, sanitizeAreaRules, sanitizeRules } from "../../../../src/shared/core/teaching-areas.ts";

const settingsInputs: unknown[] = [
	{},
	{ version: 1 },
	{ version: 0 },
	{ version: 1.5 },
	{ version: "2" },
	{ version: 7, general: { teacherName: 5, sounds: "x", activeSpace: "zzz", autoUpdate: true, keep: 1 } },
	{ general: { activeSpace: "cls_abc-1_2", onboarded: true, lastSeenVersion: "0.5.44", teacherName: "  Zed\n the  great ", sounds: false } },
	{ general: { activeSpace: "none", lastSeenVersion: "0.5", teacherName: "   " } },
	{ general: [], constructor: 1, toString: 2, __proto__: 3, x: 2 },
	{ chat: { a: 1 }, models: { b: 2 }, future: { a: [1, { z: null }] }, "10": 1, "2": 2 },
	{ appearance: { background: "#FFFFFF", proseFontSize: 99.6, fontFamily: "  ", mdRendering: { headingWeight: 5000.4, boldColor: "zzz", italicColor: null } } },
	{ appearance: { background: "#F4F1EA" } },
	{ appearance: { background: "#123", fontFamily: "Inter", proseFontSize: 11.5, mdRendering: { headingWeight: 100.5, boldColor: "#abcdef", italicColor: "#ABC" } } },
	{ appearance: { background: 5, fontFamily: 5, proseFontSize: "15", mdRendering: [] } },
	{ appearance: { mdRendering: { headingWeight: 49.4 } } },
	{ graph: { extractionChunkTokens: 10, enabled: "y" } },
	{ graph: { extractionChunkTokens: 4096.9, enabled: true } },
	{ graph: { extractionChunkTokens: -1 } },
	{ compaction: { thresholdTokens: -5 } },
	{ compaction: { thresholdTokens: 150000 } },
	{ compaction: { thresholdTokens: 31999.5 } },
	{ agent: { tools: { a: true, b: "x", c: false }, graphTools: { enabled: "x" }, rules: { voice: [" a ", "a", 3], nope: ["x"] } } },
	{ agent: { tools: { b: "x" }, graphTools: {}, rules: { voice: [] } } },
	{ agent: { graphTools: { enabled: false } } },
	{ agent: { graphTools: [] } },
	{ agent: { tools: [true], rules: [] } },
	{ agent: { prompts: { "system-prompt.md": true, "x.md": false } } },
	// Own `__proto__` keys, as JSON.parse makes them.
	JSON.parse('{"__proto__":{"x":1},"agent":{"tools":{"__proto__":true,"a":false}},"y":2}'),
];

const resolveInputs: unknown[] = [
	null,
	{},
	{ version: 2, general: { teacherName: "Zed", autoUpdate: false, sounds: false, activeSpace: "cls_a" } },
	{ general: { teacherName: "" } },
	{ appearance: { background: "#000", fontFamily: "Inter", proseFontSize: 18, mdRendering: { headingWeight: 700, boldColor: "#fff", italicColor: "#eee" } } },
	{ graph: { enabled: false, extractionChunkTokens: 800 }, compaction: { thresholdTokens: 64000 } },
	{ agent: { tools: { a: true }, rules: { voice: ["Short."] }, graphTools: { enabled: false } } },
	{ agent: { graphTools: {} } },
	{ general: { autoUpdate: null } },
];

const names = ["", "  ", "Zed", "  Zed\n the  great ", "a​b", "😀".repeat(30), "x".repeat(60), "a\tb c\u0085d", "\ud83dlone", "ab😀cd".repeat(12)];
const colors = ["#abc", "#A1b2C3", "#abcd", "abc", "#abcdeg", "", "#ABCDEF", "# abc", "#abc\n"];
const lines = ["a​b\tc d  ", "😀😀😀", "x".repeat(250), "  padded  ", "\u0000\u001f", "é".repeat(150), "\ud83d".repeat(5)];
const ruleLists: unknown[] = [["x", 1, " x ", "y"], "x", null, [], ["  ", "a", "a\nb", "A"], Array.from({ length: 30 }, (_, i) => `rule ${i}`), [["nested"], { a: 1 }, "ok"]];
const areaInputs: unknown[] = [
	{},
	null,
	[1],
	{ voice: ["Short.", "Short."], nope: ["x"], facts: [] },
	{ voice: ["a"], teaching: ["b", "c"], questions: ["d"], facts: ["e"], demos: ["f"], files: ["g"] },
	{ files: "x", demos: [3] },
];
const sections: [Record<string, string[]>, { name: string; rules: string[] } | undefined][] = [
	[{}, undefined],
	[{}, { name: "CSE 21", rules: [] }],
	[{}, { name: "CSE 21", rules: ["Use Python."] }],
	[{ voice: ["Short."] }, undefined],
	[{ voice: ["Short."], files: ["Tabs.", "Kebab names."], demos: [] }, { name: "CSE 29", rules: ["A", "B"] }],
	[{ teaching: ["One step."], questions: ["Ask first."], facts: ["Cite."] }, { name: "X (y)", rules: ["Z"] }],
];

const notesInputs: unknown[] = [
	null,
	{},
	{ notes: "x" },
	{ notes: [] },
	{ notes: [{ id: "n1", text: "t", spaceId: 5, createdAt: "now", extra: 1 }, { id: "n2", text: "t" }, "x", null, { id: "n3", text: "u", spaceId: "cls_a", createdAt: "z" }, { id: 1, text: "t", createdAt: "z" }] },
	[{ id: "n", text: "t", createdAt: "z" }],
];
const noteTexts = ["  a \n\t b  ", " \n ", "", "x".repeat(200), "x".repeat(201), "😀".repeat(100), "😀".repeat(101), "a b c﻿d", "​z"];

const whereInputs: unknown[] = [
	null,
	"voice",
	[],
	{},
	{ area: "voice" },
	{ area: "voice", spaceId: "cls_a" },
	{ area: "nope", spaceId: "cls_a" },
	{ area: "nope" },
	{ spaceId: "cls_a-b_1" },
	{ spaceId: "bad" },
	{ spaceId: 5 },
	{ area: 5, spaceId: "cls_x" },
	{ area: "files", extra: 1 },
];
const savedInputs: unknown[] = [
	null,
	{ rules: "x" },
	{
		rules: [
			{ where: { area: "teaching" }, text: "A", at: "t" },
			{ where: { area: "teaching" }, text: "", at: "t" },
			{ where: {}, text: "B", at: "t" },
			{ where: { spaceId: "cls_a" }, text: "C", at: 5 },
			{ where: { spaceId: "cls_a" }, text: "D", at: "u", extra: true },
			null,
			"x",
		],
	},
];

const seenInputs: unknown[] = [
	null,
	{},
	{ agents: [] },
	{ agents: "x" },
	{
		agents: {
			a: { at: "1", conversations: { c: { count: 2, hash: "h" }, bad: { count: -1, hash: "h" }, frac: { count: 1.5, hash: "h" }, nohash: { count: 1 }, nul: null } },
			b: { at: 5, conversations: {} },
			c: null,
			d: { at: "2", conversations: [{ count: 0, hash: "z" }] },
			e: { at: "3", conversations: "x" },
			f: { at: "4" },
		},
	},
	{ agents: [{ at: "1", conversations: {} }], version: 9 },
	JSON.parse('{"agents":{"__proto__":{"at":"1","conversations":{}},"g":{"at":"2","conversations":{"__proto__":{"count":1,"hash":"h"},"k":{"count":1,"hash":"h"}}}}}'),
];

const paths = [
	"system-prompt.md",
	"shared/30-learner-files.md",
	"teacher/20-teaching.md",
	"talk/1-a.b.md",
	"practice/00-base.md",
	"study/5-x_y.md",
	"homework/10-a.md",
	"prober/10-probe-doctrine.md",
	"",
	"teacher/teaching.md",
	"teacher/20-teaching.txt",
	"other/20-a.md",
	"teacher/../20-a.md",
	"teacher/x/20-a.md",
	"/system-prompt.md",
	"teacher/20-a.md\n",
	"teacher/20-é.md",
	"System-prompt.md",
	"shared/.md",
	"shared/20-.md",
];

const versions = ["0.5.10", "0.5.9", "1.2.3", "junk", "also junk", "0.5", "1.2.3.4", "01.02.03", "0.0.0", "10.0.0", "9.9.9", "", "1.2.3\n", "99999999999999999999.0.0"];


export default {
	"sanitizeUserSettings": () => settingsInputs.map((input) => ({ input, output: sanitizeUserSettings(input) })),
	"resolveSettings": () =>
		resolveInputs.map((input) => {
			const output = resolveSettings(input as never);
			return { input, output, graphTools: graphToolsEnabled(output) };
		}),
	"resolveSettings of sanitized": () =>
		settingsInputs.map((input) => {
			const output = resolveSettings(sanitizeUserSettings(input));
			return { input, output, graphTools: graphToolsEnabled(output) };
		}),
	"teacher names and colors": () => ({
		names: names.map((input) => ({ input, output: sanitizeTeacherName(input) })),
		colors: colors.map((input) => ({ input, output: isHexColor(input) })),
	}),
	"oneLine": () => lines.flatMap((input) => [5, 40, 200].map((max) => ({ input, max, output: oneLine(input, max) }))),
	"sanitizeRules": () => ruleLists.map((input) => ({ input, output: sanitizeRules(input) })),
	"sanitizeAreaRules": () => areaInputs.map((input) => ({ input, output: sanitizeAreaRules(input) })),
	"learnerRulesSection": () => sections.map(([rules, lessonSpace]) => ({ rules, lessonSpace: lessonSpace ?? null, output: learnerRulesSection(rules, lessonSpace) })),
	"agent notes": () => ({
		parsed: notesInputs.map((input) => ({ input, output: parseAgentNotes(input) })),
		cleaned: noteTexts.map((input) => ({ input, output: cleanNoteText(input) })),
	}),
	"agent rules": () => {
		const wheres = whereInputs.map(parseWhere);
		return {
			where: whereInputs.map((input, i) => ({ input, output: wheres[i] })),
			same: wheres.flatMap((a, i) => wheres.map((b, j) => (a && b ? { a: i, b: j, output: sameWhere(a, b) } : null)).filter(Boolean)),
			labels: wheres.flatMap((w) => (w ? [undefined, "CSE 21"].map((name) => ({ where: w, name: name ?? null, ruleFor: ruleFor(w, name), whereLabel: whereLabel(w, name) })) : [])),
			saved: savedInputs.map((input) => ({ input, output: parseSavedRules(input) })),
		};
	},
	"agent seen": () => {
		const prints = ["a", "b", "c", "😀", "", "x\u0000y"];
		const marks = [0, 1, 2, 3, 6].map((n) => ({ n, output: seenMark(prints.slice(0, n)) }));
		let file = parseAgentSeen(null);
		const steps: unknown[] = [];
		for (let i = 0; i < 24; i++) {
			file = withSeen(file, `agent${i % 23}`, i % 3 === 0 ? "chat" : `chat${i}`, { count: i, hash: `h${i}` }, `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`);
			steps.push(structuredClone(file));
		}
		const ties = withSeen(withSeen(parseAgentSeen(null), "x", "c", { count: 1, hash: "h" }, "T"), "y", "c", { count: 1, hash: "h" }, "T");
		const mixed = withSeen(
			parseAgentSeen({ agents: { Zed: { at: "b", conversations: {} }, apple: { at: "B", conversations: {} }, mid: { at: "a", conversations: {} } } }),
			"new",
			"c",
			{ count: 2, hash: "q" },
			"A",
		);
		return { parsed: seenInputs.map((input) => ({ input, output: parseAgentSeen(input) })), marks, steps, ties, mixed };
	},
	"segment paths": () => paths.map((input) => ({ input, output: isValidSegmentPath(input) })),
	"changelog": () => {
		const small = [
			{ version: "0.5.2", date: "d", changes: [] },
			{ version: "0.5.10", date: "d", changes: [] },
			{ version: "0.4.0", date: "d", changes: [] },
			{ version: "bad", date: "d", changes: [] },
		];
		const pairs = versions.flatMap((a) => versions.map((b) => ({ a, b, output: compareVersions(a, b) })));
		return {
			isVersion: [...versions, null, 5, undefined].map((input) => ({ input: input ?? null, output: isVersion(input) })),
			compare: pairs,
			since: [["0.5.41", "0.5.43"], ["0.0.0", "99.0.0"], ["0.5.44", "0.5.44"], ["junk", "0.5.3"], ["0.4.0", "0.5.10"], ["0.5.2", "junk"]].map(([since, current]) => ({
				since,
				current,
				output: entriesSince(since, current, CHANGELOG).map((e) => e.version),
				small: entriesSince(since, current, small).map((e) => e.version),
			})),
			entry: ["0.5.44", "0.5.1", "9.9.9", "", "bad"].map((version) => ({ version, output: entryFor(version, CHANGELOG)?.date ?? null, small: entryFor(version, small) })),
			length: CHANGELOG.length,
			first: CHANGELOG[0],
			last: CHANGELOG[CHANGELOG.length - 1],
		};
	},
};
