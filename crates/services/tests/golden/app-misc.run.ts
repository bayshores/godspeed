// Runs the settings parsers, the prompt segment lists, the activity log, the saved-rules code and
// the reading view over a fresh data folder and home folder with a synthetic class, and prints
// what each answered. app-misc.golden.ts starts it in its own process with LH_DATA_DIR and HOME
// set, because the stores fix their folders when they load. Ids and times the TypeScript run made
// are masked ("<id>", "<now>"): the Rust run makes its own.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

if (!process.env.LH_DATA_DIR || !process.env.HOME) throw new Error("LH_DATA_DIR and HOME must be set");
const DATA = fs.realpathSync(process.env.LH_DATA_DIR);
// The code reads the home folder as the environment names it, not as the disk resolves it.
const HOME = process.env.HOME;
console.error = () => {};
console.warn = () => {};

const CLASS = "cls_golden01_00000001";
const GONE = "cls_gone0000_00000000";
const AT = "2029-03-01T10:00:00.000Z";
const tabs = (v: unknown) => `${JSON.stringify(v, null, "\t")}\n`;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const mask = (list: { id: string; at: string }[]) => list.map((entry) => ({ ...entry, id: "<id>", at: "<now>" }));

fs.mkdirSync(path.join(DATA, "classes", CLASS), { recursive: true });
fs.writeFileSync(
	path.join(DATA, "classes", CLASS, "class.json"),
	tabs({ id: CLASS, name: "Golden Class", description: "", createdAt: AT, updatedAt: AT, archived: false, files: [], removedFiles: [], deadlines: [], version: 1 }),
);

const { SETTINGS_SECTIONS } = await import("../../../../src/backend/server/settings-body.ts");
const prompts = await import("../../../../src/backend/agent/prompt-segments.ts");
const actions = await import("../../../../src/backend/server/agent-actions.ts");
const rules = await import("../../../../src/backend/server/agent-rules.ts");
const reading = await import("../../../../src/backend/server/reading-pages.ts");
const { readSettings } = await import("../../../../src/backend/store/settings.ts");
const { readAgentActions } = await import("../../../../src/backend/store/agent-actions.ts");

// Settings bodies: every parser against good and bad shapes.
const BODIES: [keyof typeof SETTINGS_SECTIONS, unknown][] = [
	["general", {}],
	["general", null],
	["general", []],
	["general", "text"],
	["general", { teacherName: "  Zed   the  Wise  ", sounds: false, autoUpdate: true, onboarded: true, extra: 1 }],
	["general", { teacherName: "   " }],
	["general", { teacherName: 5 }],
	["general", { activeClass: "none", lastSeenVersion: "0.5.44" }],
	["general", { activeClass: CLASS }],
	["general", { activeClass: "cls_bad" }],
	["general", { lastSeenVersion: "v1" }],
	["general", { lastSeenVersion: "01.2.3" }],
	["general", { autoUpdate: "yes" }],
	["general", { onboarded: 1 }],
	["general", { sounds: null }],
	["agent", {}],
	["agent", { tools: { explain: false } }],
	["agent", { tools: { nope: true } }],
	["agent", { tools: { explain: "no" } }],
	["agent", { tools: [] }],
	["agent", { rules: { voice: ["Be brief", "  Be   brief  ", "", "x".repeat(400)], demos: [] } }],
	["agent", { rules: { nope: [] } }],
	["agent", { rules: { voice: "text" } }],
	["agent", { rules: { voice: [1] } }],
	["agent", { rules: [] }],
	["agent", { graphTools: {} }],
	["agent", { graphTools: { enabled: false, other: 1 } }],
	["agent", { graphTools: { enabled: "no" } }],
	["agent", { graphTools: null }],
	["appearance", {}],
	["appearance", { background: "#112233", fontFamily: "Inter", proseFontSize: 16, mdRendering: { headingWeight: 600, boldColor: "#abc", italicColor: null } }],
	["appearance", { background: null, fontFamily: null }],
	["appearance", { background: "red" }],
	["appearance", { background: 5 }],
	["appearance", { fontFamily: "  " }],
	["appearance", { fontFamily: 5 }],
	["appearance", { proseFontSize: 11 }],
	["appearance", { proseFontSize: 25 }],
	["appearance", { proseFontSize: 16.5 }],
	["appearance", { proseFontSize: "16" }],
	["appearance", { mdRendering: {} }],
	["appearance", { mdRendering: [] }],
	["appearance", { mdRendering: { headingWeight: 99 } }],
	["appearance", { mdRendering: { headingWeight: 901 } }],
	["appearance", { mdRendering: { boldColor: "blue" } }],
	["appearance", { mdRendering: { italicColor: 3 } }],
	["graph", {}],
	["graph", { enabled: true, extractionChunkTokens: 123456.9, old: 1 }],
	["graph", { enabled: "on" }],
	["graph", { extractionChunkTokens: "big" }],
	["graph", { extractionChunkTokens: 10 }],
	["graph", { extractionChunkTokens: 1e300 }],
	["compaction", {}],
	["compaction", { thresholdTokens: 50000.7 }],
	["compaction", { thresholdTokens: 5 }],
	["compaction", { thresholdTokens: "5" }],
	["compaction", { thresholdTokens: null }],
];
const settingsBodies = BODIES.map(([section, body]) => ({ section, body, result: SETTINGS_SECTIONS[section](body) }));

// The prompt list Settings shows (teacher then prober, one entry per path) and the paths a saved
// version may be for.
const listed = new Map<string, { path: string; shared: boolean; sourceSha: string }>();
for (const agent of ["teacher", "prober"] as const) {
	for (const s of prompts.effectivePromptSegments(agent)) listed.set(s.path, { path: s.path, shared: s.shared, sourceSha: sha(s.sourceText) });
}
const promptList = { segments: [...listed.values()], supported: prompts.allSegmentPaths() };

// The activity log.
const target = { kind: "deadline", id: "ddl_gold00000001" };
const act = (label: string, extra: object = {}) => ({ label, classId: CLASS, target, page: "/", ...extra });
actions.noteAgentAction("Claude", act("Added Test 2"));
actions.noteAgentAction("Claude", act("Added Test 2"));
actions.noteAgentAction("Codex", act("Added Test 2"));
actions.noteAgentAction(undefined, act("  Wrote   a   lesson\n plan  ", { target: null, page: "/chat" }));
actions.noteAgentAction("  ", act("Removed a file", { removed: true, target: null }));
actions.noteAgentAction("  ", act("Removed a file", { removed: true, target: null }));
actions.noteAgentAction("Claude", act("word ".repeat(30), { target: null, open: true }));
actions.recordFolderFiles(CLASS, 1, "Google Drive");
actions.recordFolderFiles(CLASS, 2, "Google Drive");
actions.recordFolderFiles(CLASS, 1, "a folder");
actions.recordAnswer({ id: "chat_a", classId: CLASS }, { kind: "quiz", correct: true } as never);
actions.recordAnswer({ id: "chat_a", classId: CLASS }, { kind: "quiz", correct: false } as never);
actions.recordAnswer({ id: "chat_a", classId: CLASS }, { kind: "quiz", correct: true, dontKnow: true } as never);
actions.recordAnswer({ id: "chat_a", classId: CLASS }, { kind: "open" } as never);
actions.recordAnswer({ id: "chat_b" }, { kind: "quiz", correct: false } as never);
actions.recordDeadlineChange(CLASS, { id: "ddl_gold00000002", name: "Quiz 1" }, "added");
actions.recordDeadlineChange(CLASS, { id: "ddl_gold00000002", name: "Quiz 1" }, { date: "2030-01-01", time: "10:00" });
actions.recordDeadlineChange(CLASS, { id: "ddl_gold00000002", name: "Quiz 1" }, { done: true });
actions.recordDeadlineChange(CLASS, { id: "ddl_gold00000002", name: "Quiz 1" }, { name: "Quiz one" });
const activity = { shown: mask(actions.recentAgentActions()), saved: mask(readAgentActions()) };

// Saved rules: in a teaching area's list and in a class's list.
const voice = { area: "voice" } as const;
const mine = { classId: CLASS } as const;
const missing = { classId: GONE } as const;
const mark = (list: { where: unknown; text: string; at: string }[]) => list.map((s) => ({ ...s, at: "<now>" }));
const ruleSteps: { op: string; outcome: unknown }[] = [];
const step = (op: string, outcome: unknown) => ruleSteps.push({ op, outcome });
step("save", rules.saveRuleByAgent("Be brief", voice, "Claude"));
step("save again", rules.saveRuleByAgent("Be brief", voice));
step("save one line", rules.saveRuleByAgent("  Use   one\n line ", voice));
step("save empty", rules.saveRuleByAgent("   ", voice));
step("save too long", rules.saveRuleByAgent("x".repeat(400), voice));
step("save in a class", rules.saveRuleByAgent("Show the proof first", mine, "Codex"));
step("save in a missing class", rules.saveRuleByAgent("Anything", missing));
step("marks", mark(rules.agentSavedRules()));
step("edit", rules.editRule(voice, "Be brief", "Be very brief"));
step("edit to an existing one", rules.editRule(voice, "Be very brief", "Use one line"));
step("edit a missing rule", rules.editRule(voice, "Not here", "Anything"));
step("edit in a missing class", rules.editRule(missing, "Not here", "Anything"));
step("edit to nothing", rules.editRule(voice, "Be very brief", " "));
step("remove", rules.removeRule(mine, "Show the proof first"));
step("remove again", rules.removeRule(mine, "Show the proof first"));
step("remove in a missing class", rules.removeRule(missing, "x"));
step("marks after", mark(rules.agentSavedRules()));
const saved = { steps: ruleSteps, settings: readSettings() };

// The reading view, over files in the home folder.
const put = (name: string, content: string | Buffer) => {
	fs.mkdirSync(path.dirname(path.join(HOME, name)), { recursive: true });
	fs.writeFileSync(path.join(HOME, name), content);
};
put("notes/a.txt", "hello\nworld");
put("notes/zero.txt", "a\u0000b");
put("notes/big.txt", "x".repeat(2 * 1024 * 1024 + 1));
put("notes/edge.txt", "x".repeat(2 * 1024 * 1024));
put("notes/bytes.txt", Buffer.from([0x68, 0xff, 0x69]));
put(".hidden/a.txt", "x");
put("notes/.dot.txt", "x");
put("notes/empty.txt", "");
put("notes/page.png", "not a pdf");
fs.mkdirSync(path.join(HOME, "notes/folder"), { recursive: true });
const readingCases: [string, string][] = [
	["text", path.join(HOME, "notes/a.txt")],
	["with a nul byte", path.join(HOME, "notes/zero.txt")],
	["over two megabytes", path.join(HOME, "notes/big.txt")],
	["exactly two megabytes", path.join(HOME, "notes/edge.txt")],
	["bad utf-8", path.join(HOME, "notes/bytes.txt")],
	["empty", path.join(HOME, "notes/empty.txt")],
	["missing", path.join(HOME, "notes/none.txt")],
	["a folder", path.join(HOME, "notes/folder")],
	["in a dot folder", path.join(HOME, ".hidden/a.txt")],
	["a dot file", path.join(HOME, "notes/.dot.txt")],
	["the home folder", HOME],
	["outside home", path.join(DATA, "agent-actions.json")],
	["a dotted way out", path.join(HOME, "notes/../../etc/hosts")],
	["a way back in", path.join(HOME, "notes/../notes/a.txt")],
	["a pdf name on a text file", path.join(HOME, "notes/page.png")],
];
const readingOutcomes = [];
for (const [name, file] of readingCases) {
	const outcome = await reading.readingDocument(file);
	readingOutcomes.push({ name, outcome: outcome.ok && outcome.value.kind === "text" ? { ok: true, value: { kind: "text", textSha: sha(outcome.value.text), length: outcome.value.text.length } } : outcome });
}
const notPdf = await reading.readingPdfPage(path.join(HOME, "notes/a.txt"), 1);
const hiddenPage = await reading.readingPdfPage(path.join(HOME, ".hidden/a.txt"), 1);

console.log(JSON.stringify({ settingsBodies, promptList, activity, saved, reading: { documents: readingOutcomes, notPdf, hiddenPage } }));
