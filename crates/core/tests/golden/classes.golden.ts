// Class files, deadlines' agent text, the agent folder, the briefing and today's note: each case
// lists its inputs beside the output so the Rust test can run them again. Seed class files come
// from tests/fixtures/classes (two made-up classes).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { agentBriefing } from "../../../../src/shared/core/agent-briefing.ts";
import { claudeSettings, copyCommand, mcpJson, shortFolder, startScript, startScriptPath, usableFolder, withoutJsonEntry, withoutOldCodexServer } from "../../../../src/shared/core/agent-folder.ts";
import { missingSetup, SETUP_HOW } from "../../../../src/shared/core/class-setup.ts";
import { classDirs, readmeText, safeEntryName, shortcutLayout, uniqueName } from "../../../../src/shared/core/class-shortcuts.ts";
import { CLASS_ARG_TEXT, CLASS_TOOL_TEXT, DEADLINE_KINDS, FILE_KINDS, lessonStartedLastTurn } from "../../../../src/shared/core/class-tools.ts";
import { askedDeadlineIds, coverageRequest, talkQuiet, unlinkedDeadlines } from "../../../../src/shared/core/deadline-requests.ts";
import { fileGroups, pairSeries } from "../../../../src/shared/core/file-groups.ts";
import { dateInName, groupFileSeries } from "../../../../src/shared/core/file-series.ts";
import { recordingsToRecheck, transcriptFor } from "../../../../src/shared/core/lecture-transcript.ts";
import { folderName, folderSource, isGoogleDriveFolder } from "../../../../src/shared/core/linked-folder.ts";
import { isNewFolderFile, isRecent, isRecentChange, kindsForNewFiles } from "../../../../src/shared/core/new-files.ts";
import { clockLabel, dayLabel, deadlinePartOf, localDay, timeZoneLabel, todayNoteText, todayNoteToAppend, wallClock, whenLabel } from "../../../../src/shared/core/today-note.ts";

const ZONE = "America/Los_Angeles";
const here = path.dirname(fileURLToPath(import.meta.url));
const seed = (id: string) => JSON.parse(fs.readFileSync(path.join(here, "../fixtures/classes", id, "class.json"), "utf8"));
const SEEDS = [seed("cls_cvq4t7in_101dfecb"), seed("cls_cvq4t7n0_31e7df8c")];

type F = { id: string; origin: string; name: string; path: string; kind: string; contentFp: string; status: string; addedAt: string; [k: string]: unknown };
let counter = 0;
const file = (name: string, extra: Partial<F> = {}): F => ({ id: `s${++counter}`, origin: "copied", name, path: `/data/${name}`, kind: "study", contentFp: "fp", status: "ready", addedAt: "2026-10-01T00:00:00.000Z", ...extra });

// Names the groupers have to read: both date forms, emoji, codes, numbered, recordings, odd ones.
const NAMES = [
	"Lecture 01 2026-09-24.pdf", "Lecture 02 20260926.pdf", "Lecture 03 2026-10-01.pdf", "Lecture 04 20261003.pdf",
	"Lecture 01 2026-09-24 transcript.vtt", "Lecture 02 20260926 transcript.vtt", "Lecture 03 2026-10-01 transcript.vtt", "Lecture 04 20261003 transcript.vtt",
	"Lecture 3 recording.mp4", "Lecture 5 2026-10-08.mp4", "lecture_6.srt",
	"Day1 notes 📚.pdf", "Day2 notes 📚.pdf", "Day3 notes 📚.pdf", "Day10 notes 📚.pdf",
	"Week 1 Discussion.pdf", "Week 2 Discussion.pdf", "Week 3 Discussion.pdf", "Week 1 Late Discussion.pdf", "Week 2 Late Discussion.pdf",
	"PS3_F26.pdf", "PS4_F26.pdf", "PS5_F26.pdf", "CSE21 HW1.pdf", "CSE21 HW2.pdf",
	"06_Sets.pdf", "07_Probability.pdf", "08_Logic.pdf", "01_Intro.pdf",
	"29-fa26-l3.pdf", "29-fa26-l4.pdf", "29-fa26-l5.pdf",
	"🎓 syllabus 😀.pdf", "notes (copy).txt", "README", "Makefile", "a.b.c.docx", "slides 20261301.pdf", "x 2026-09-24 y 20261224.pdf",
	"20260924.pdf", "120260924.pdf", "2026092412.pdf", "Quiz 1.pdf", "Quiz 2.pdf", "Review week 4.pdf", "midterm practice (2026-11-04).pdf", ".hidden", "ünïcödé 3.md", "ünïcödé 4.md",
];
const seedNames = SEEDS.flatMap((c) => c.files.map((f: F) => f.name));
const synthetic: F[] = NAMES.map((n) => file(n));

const recordings: F[] = [
	file("Lecture 3 2026-10-05.mp4"),
	file("Lecture 3 2026-10-05 transcript.vtt"),
	file("Lecture 4.mp4", { transcriptId: "gone" }),
	file("Lecture 5 2026-10-12.mp4", { status: "pending" }),
	file("Lecture 5 2026-10-12.srt"),
	file("Lecture 6 2026-10-14.mp4", { error: "The file could not be found" }),
	file("Lecture 6 2026-10-14 transcript.txt"),
	file("Lecture 7.mp4", { kind: "info" }),
	file("Lecture 7 transcript.vtt"),
	file("Office hours 2026-10-14.mp4"),
	file("Office hours 2026-10-14 transcript.vtt"),
	file("Lecture 8 2026-10-19.mp4", { transcriptId: "s999" }),
	file("lecture 8 2026-10-19 notes.pdf"),
];
recordings[11]!.transcriptId = recordings[10]!.id;
recordings[2]!.transcriptId = "gone";

const SETS: Record<string, F[]> = {
	synthetic,
	recordings,
	"CSE 21": SEEDS[0].files,
	"CSE 29": SEEDS[1].files,
	"CSE 21 first 40": SEEDS[0].files.slice(0, 40),
	"CSE 29 last 40": SEEDS[1].files.slice(-40),
	empty: [],
	"one file": [file("only.pdf")],
};

const idx = (files: unknown[], f: unknown) => files.indexOf(f);
const canonSeries = (files: F[], s: { key: string; label: string; items: { number: number; files: F[]; date: string | null }[] }) => ({
	key: s.key,
	label: s.label,
	items: s.items.map((i) => ({ number: i.number, files: i.files.map((f) => idx(files, f)), date: i.date })),
});

function classLike(over: Record<string, unknown> = {}) {
	return { id: "cls_a", name: "CSE 21", description: "d", archived: false, files: [] as F[], deadlines: [] as unknown[], ...over };
}

const d = (id: string, kind: string, name: string, date: string, extra: Record<string, unknown> = {}) => ({ id, kind, name, date, fileIds: [] as string[], done: false, ...extra });

// ─── time ───────────────────────────────────────────────────────────────────
const INSTANTS = [
	"2026-10-31T06:59:59.000Z", // 23:59:59 PDT on Oct 30
	"2026-11-01T07:59:59.000Z", // 00:59:59 PDT, the night the clocks go back
	"2026-11-01T08:30:00.000Z", // 01:30 PDT
	"2026-11-01T09:30:00.000Z", // 01:30 PST, the second time
	"2026-11-01T10:00:00.000Z",
	"2026-11-02T07:59:00.000Z",
	"2026-11-02T08:00:00.000Z",
	"2026-11-10T12:00:00.000Z",
	"2026-03-08T09:59:00.000Z", // just before spring forward
	"2026-03-08T10:00:00.000Z",
	"2026-07-04T19:00:00.000Z",
	"2026-12-31T23:59:59.000Z",
	"2027-01-01T08:00:00.000Z",
	"1970-01-01T00:00:00.000Z",
];

const HOMEWORK_FILES = [file("PS5_F26.pdf", { addedAt: "2026-11-09T10:00:00.000Z" }), file("HW5 solutions 📝.pdf", { addedAt: "2026-11-08T10:00:00.000Z", kind: "info" })];
const manyNew = Array.from({ length: 9 }, (_, i) => file(`New ${i + 1} 🌱.pdf`, { addedAt: `2026-11-09T0${i}:00:00.000Z`, kind: i % 3 === 0 ? "info" : "study" }));
const noteClasses: (ReturnType<typeof noteClass> | null)[] = [
	null,
	noteClass([]),
	noteClass([d("a", "exam", "Midterm", "2026-11-04", { time: "18:30" }), d("b", "homework", "HW5", "2026-11-01"), d("c", "quiz", "Quiz 3", "2026-11-01", { time: "00:30" }), d("e", "project", "PA2", "2026-10-31", { time: "23:59" }), d("f", "exam", "Done exam", "2026-11-02", { done: true })]),
	noteClass([d("a", "exam", "Final", "2026-12-12", { fileIds: manyNew.map((f) => f.id) })], manyNew),
	noteClass([d("a", "homework", "HW5", "2026-11-10", { fileIds: [HOMEWORK_FILES[0]!.id, "ghost", HOMEWORK_FILES[1]!.id] })], HOMEWORK_FILES),
	noteClass([], HOMEWORK_FILES, [
		{ statement: "Show that $\\sum_{i=1}^n i = n(n+1)/2$.\n\n  Use induction.", at: "2026-11-08T05:00:00.000Z" },
		{ statement: "x".repeat(200), at: "2026-11-09T05:00:00.000Z" },
		{ statement: "old one", at: "2026-10-01T05:00:00.000Z" },
		{ statement: "emoji 😀 ".repeat(30), at: "2026-11-07T05:00:00.000Z" },
		{ statement: "third", at: "2026-11-06T05:00:00.000Z" },
		{ statement: "fourth", at: "2026-11-05T05:00:00.000Z" },
	]),
	noteClass([d("a", "exam", "Midterm", "2026-11-04")], [], [{ statement: "hinted", at: "2026-11-09T05:00:00.000Z" }]),
];
function noteClass(deadlines: unknown[], files: F[] = [], hinted?: { statement: string; at: string }[]) {
	return { deadlines, files, ...(hinted ? { hinted } : {}) };
}

// ─── the briefing ───────────────────────────────────────────────────────────
const briefingClasses = [
	{ id: "cls_cvq4t7in_101dfecb", name: "CSE 21", archived: false, deadlines: SEEDS[0].deadlines, missingSetup: [] as string[] },
	{ id: "cls_cvq4t7n0_31e7df8c", name: "CSE 29", archived: false, deadlines: SEEDS[1].deadlines, missingSetup: ["description"] },
	{ id: "cls_old", name: "Old class", archived: true, deadlines: [d("x", "exam", "Gone", "2026-11-12")], missingSetup: ["icon", "signature"] },
	{ id: "cls_new", name: "Brand new 🆕", archived: false, deadlines: [d("n1", "quiz", "Quiz", "2026-11-11", { time: "09:00" }), d("n2", "homework", "Late HW", "2026-11-09")], missingSetup: ["icon", "signature", "description"] },
];
const lessons = [
	{ id: "chat_1", title: "Counting", classId: "cls_cvq4t7in_101dfecb", updatedAt: "2026-11-09T20:00:00.000Z", waiting: true },
	{ id: "chat_2", title: "Pointers 📌", classId: "cls_cvq4t7n0_31e7df8c", updatedAt: "2026-11-08T20:00:00.000Z", waiting: false },
	{ id: "chat_3", title: "Free talk", updatedAt: "2026-11-07T20:00:00.000Z", waiting: false },
	{ id: "chat_4", title: "Orphan", classId: "cls_gone", updatedAt: "2026-11-06T20:00:00.000Z", waiting: false },
	{ id: "chat_5", title: "Five", classId: "cls_new", updatedAt: "2026-11-05T20:00:00.000Z", waiting: false },
	{ id: "chat_6", title: "Six", classId: "cls_new", updatedAt: "2026-11-04T20:00:00.000Z", waiting: true },
	{ id: "chat_7", title: "Seven", updatedAt: "2026-11-03T20:00:00.000Z", waiting: false },
];
const agentNotes = [
	{ id: "note_aaaa1111", text: "Prefers short answers", classId: "cls_cvq4t7in_101dfecb", createdAt: "2026-11-01T20:00:00.000Z" },
	{ id: "note_bbbb2222", text: "Likes worked examples 🧮", createdAt: "2026-11-02T20:00:00.000Z" },
	{ id: "note_cccc3333", text: "About a class that was deleted", classId: "cls_gone", createdAt: "2026-11-03T20:00:00.000Z" },
];

function briefing(maxChars: number, now: string, over: Record<string, unknown> = {}) {
	const input = { now: new Date(now), timeZone: ZONE, classes: briefingClasses, lessons, notes: agentNotes, maxChars, ...over };
	let out: string;
	try {
		out = agentBriefing(input as never);
	} catch (err) {
		out = `error: ${err instanceof Error ? err.message : String(err)}`;
	}
	return { now, maxChars, classes: input.classes, lessons: input.lessons, notes: input.notes, output: out };
}

// ─── deadline requests ──────────────────────────────────────────────────────
const readyFile = { id: "f1", kind: "study", status: "ready" };
const requestClasses = [
	{ id: "cls_a", name: "CSE 21", archived: false, files: [readyFile], deadlines: [d("d1", "exam", "Midterm", "2026-11-12", { time: "10:00" }), d("d2", "homework", "Past", "2026-11-01"), d("d3", "quiz", "Linked", "2026-11-12", { fileIds: ["f1"] }), d("d4", "quiz", "Asked", "2026-11-12"), d("d5", "quiz", "Done", "2026-11-12", { done: true }), d("d6", "project", "Today", "2026-11-10")] },
	{ id: "cls_b", name: "Archived", archived: true, files: [readyFile], deadlines: [d("e1", "exam", "Nope", "2026-12-01")] },
	{ id: "cls_c", name: "No study file", archived: false, files: [{ id: "f", kind: "info", status: "ready" }, { id: "g", kind: "study", status: "pending" }], deadlines: [d("g1", "exam", "Nope", "2026-12-01")] },
	{ id: "cls_d", name: "Empty time 🕐", archived: false, files: [readyFile], deadlines: [d("h1", "exam", "Final 🎓", "2026-12-10", { time: "" }), { ...d("h2", "exam", "No ids", "2026-12-11"), fileIds: [] }] },
	{ id: "cls_e", name: "No deadlines", archived: false, files: [readyFile] },
];

export default {
	// ── names and series ──
	"date in name": () => [...new Set([...NAMES, ...seedNames])].map((name) => ({ name, output: dateInName(name) })),
	"file series": () =>
		Object.entries(SETS).map(([set, files]) => {
			const { series, other } = groupFileSeries(files);
			return { set, files: files.map((f) => ({ id: f.id, name: f.name })), series: series.map((s) => canonSeries(files, s)), other: other.map((f) => idx(files, f)) };
		}),
	"file groups": () =>
		Object.entries(SETS).map(([set, files]) => {
			const { series } = groupFileSeries(files);
			const pairs = [...pairSeries(series as never).entries()].map(([t, n]) => [series.indexOf(t as never), series.indexOf(n as never)]).sort((a, b) => a[0]! - b[0]!);
			const groups = fileGroups(files as never).map((g) => ({ key: g.key, label: g.label, count: g.count, items: g.items.map((i) => ({ key: i.key, label: i.label, date: i.date, files: i.files.map((f) => idx(files, f)) })) }));
			return { set, files, pairs, groups };
		}),
	"lecture transcripts": () =>
		Object.entries(SETS).map(([set, files]) => ({
			set,
			files: files.map((f) => ({ id: f.id, name: f.name, kind: f.kind, status: f.status, transcriptId: f.transcriptId, error: f.error })),
			transcripts: files.map((f) => idx(files, transcriptFor(f as never, files as never))),
			recheck: recordingsToRecheck(files as never),
		})),

	// ── new files ──
	"recent times": () => {
		const now = Date.parse("2026-11-10T12:00:00.000Z");
		const ats = ["2026-11-10T11:00:00.000Z", "2026-11-07T12:00:00.000Z", "2026-11-07T11:59:59.999Z", "2026-10-27T12:00:00.000Z", "2026-10-27T11:59:59.999Z", "2026-11-11T00:00:00.000Z", "nope", "", "2026-11-09"];
		return ats.map((at) => ({
			now,
			at,
			recent: isRecent(at, now),
			change: isRecentChange(at, now),
			noAt: isRecent(undefined, now),
			scanned: isNewFolderFile({ foundByScan: true, addedAt: at }, now),
			notScanned: isNewFolderFile({ foundByScan: false, addedAt: at }, now),
			unset: isNewFolderFile({ addedAt: at }, now),
		}));
	},
	"kinds for new files": () => {
		const existing = [file("PS1_F26.pdf", { kind: "info" }), file("PS2_F26.pdf", { kind: "info" }), file("PS3_F26.pdf", { kind: "info" }), file("Lecture 1.pdf"), file("Lecture 2.pdf"), file("Mixed 1.pdf"), file("Mixed 2.pdf", { kind: "info" }), file("Mixed 3.pdf", { kind: "info" })];
		const added = [file("PS4_F26.pdf"), file("Lecture 3.pdf"), file("Mixed 4.pdf"), file("Other 📎.pdf")];
		const run = (ex: F[], ad: F[]) => ({ existing: ex.map((f) => ({ id: f.id, name: f.name, kind: f.kind })), added: ad.map((f) => ({ id: f.id, name: f.name })), kinds: Object.fromEntries(kindsForNewFiles(ex, ad)) });
		return [run(existing, added), run(existing, []), run([], added), run(SEEDS[0].files.slice(0, 120), [file("PS6_F26.pdf"), file("Lecture 20 2026-11-04.pdf")])];
	},

	// ── folders and setup ──
	"linked folders": () =>
		[
			"/Users/a/Library/CloudStorage/GoogleDrive-a@b.com/My Drive/Classes/CSE 21",
			"/Users/a/Library/CloudStorage/GoogleDrive-a@b.com",
			"/Users/a/Library/CloudStorage/GoogleDrive-a@b.com/",
			"/Users/a/Library/CloudStorage/Dropbox/CSE 21",
			"/Users/a/Library/CloudStorage/GoogleDrive-/x",
			"/Users/a/classes/CSE 29/",
			"/Users/a/classes/CSE 29///",
			"C:\\Users\\a\\Classes\\Math 20C\\",
			"C:\\Users\\a\\Classes\\Math 20C",
			"/",
			"//",
			"",
			"/Users/a/📚 Notes",
			"relative/dir",
		].map((folder) => ({ folder, drive: isGoogleDriveFolder(folder), name: folderName(folder), source: folderSource(folder) })),
	"missing setup": () => {
		const cases = [
			{ description: "", icon: undefined, signature: undefined },
			{ description: "  ", icon: "cpu", signature: { kind: "text", value: "x" } },
			{ description: "About", icon: "cpu", signature: undefined },
			{ description: "About", icon: undefined, signature: { kind: "math", value: "x" } },
			{ description: "About", icon: "cpu", signature: { kind: "text", value: "x" } },
			{ description: "\u00a0\n", icon: "", signature: undefined },
		];
		return { how: SETUP_HOW, cases: cases.map((c) => ({ ...c, missing: missingSetup(c as never) })) };
	},

	// ── the tools' text ──
	"class tool text": () => ({ tools: CLASS_TOOL_TEXT, args: CLASS_ARG_TEXT, deadlineKinds: DEADLINE_KINDS, fileKinds: FILE_KINDS }),
	"lesson started last turn": () => {
		const result = (page: string, extra: Record<string, unknown> = {}) => ({ role: "toolResult", toolName: "start_lesson", isError: false, details: { changes: [{ label: "x", page }] }, ...extra });
		const lists: unknown[][] = [
			[],
			[{ role: "user", content: "hi" }],
			[{ role: "user", content: "hi" }, { role: "assistant", content: [] }, result("/chat/chat_abc")],
			[{ role: "user", content: "hi" }, result("/chat/chat_abc"), { role: "assistant", content: [] }],
			[{ role: "assistant" }, result("/chat/chat_abc", { isError: true })],
			[result("/chat/chat_old"), result("/chat/chat_new")],
			[result("/chat/chat_old"), { role: "toolResult", toolName: "list_classes", details: null }],
			[result("/chat/")],
			[result("/class/files")],
			[{ role: "toolResult", toolName: "start_lesson", isError: false, details: null }],
			[{ role: "custom", customType: "x" }, result("/chat/chat_abc")],
		];
		return lists.map((messages) => ({ messages, output: lessonStartedLastTurn(messages as never) }));
	},

	// ── shortcuts ──
	"safe names": () =>
		["CSE 21", "a/b", "a\\b:c*d?e\"f<g>h|i", "name. ", "...", "", "   ", "CON", "con.txt", "NUL.tar.gz", "com1", "lpt9.pdf", "COM10", "aux.", "x".repeat(200), `${"é".repeat(100)}.pdf`, "📚 notes 😀.pdf", "tab\tname", "\u0000nul", ".hidden", "a.b", "end.dot.", "  lead", "Archived", "READ ME.txt"].map((name) => ({ name, output: safeEntryName(name) })),
	"unique names": () => {
		const runs = [["a.pdf", "A.pdf", "a.pdf", "b", "b", "B", ".x", ".x", "a (2).pdf", "a.pdf"], ["Notes", "notes", "NOTES", "notes (2)"], ["x.tar.gz", "x.tar.gz", "x.TAR.gz"]];
		return runs.map((names) => {
			const taken = new Set<string>();
			return { names, output: names.map((n) => uniqueName(n, taken)) };
		});
	},
	"shortcut layout": () => {
		const classes = [
			{ id: "cls_a", name: "CSE 21", archived: false, files: SEEDS[0].files },
			{ id: "cls_b", name: "cse 21", archived: false, files: SEEDS[1].files.slice(0, 60) },
			{ id: "cls_c", name: "Archived", archived: false, files: [file("Lecture 1.pdf"), file("Lecture 2.pdf"), file("Lecture 1 transcript.vtt"), file("Lecture 2 transcript.vtt")] },
			{ id: "cls_d", name: "Old: class?", archived: true, files: synthetic },
			{ id: "cls_e", name: "old: class?", archived: true, files: [file("a.pdf"), file("a.pdf"), file("A.PDF")] },
			{ id: "cls_f", name: "READ ME.txt", archived: false, files: [] },
			{ id: "cls_g", name: "🎓 Grad", archived: false, files: [file("syllabus.pdf", { path: "/x/sub/syllabus.pdf" })] },
		];
		const dirs = classDirs(classes);
		return { classes, dirs: Object.fromEntries(dirs), layout: shortcutLayout(classes as never) };
	},
	"readme text": () => [[], ["a.pdf"], ["a.pdf", "b/c.pdf", "😀.pdf"]].map((skipped) => ({ skipped, output: readmeText(skipped) })),

	// ── the agent folder ──
	"agent folder text": () => {
		const folders = ["/Users/a/godspeed", "/Users/a/godspeed/", "/Users/a/my folder/godspeed", "C:\\Users\\a\\godspeed", "C:\\Users\\a\\godspeed\\", "/Users/a/📚/godspeed", "/Users/a/it's", 'a"b', "relative", "/a\nb", "/a`b", "/a$b", "", "/", "D:\\", "D:/x"];
		const platforms = ["darwin", "win32", "linux"] as const;
		const agents = ["claude", "codex"] as const;
		return folders.map((folder) => {
			const usable = usableFolder(folder);
			return {
				folder,
				usable,
				short: [shortFolder(folder, "/Users/a"), shortFolder("/Users/a", "/Users/a"), shortFolder("/Users/ab/x", "/Users/a")],
				platforms: usable
					? Object.fromEntries(
							platforms.map((p) => [
								p,
								{
									mcp: mcpJson(folder, p),
									settings: claudeSettings(folder, p),
									agents: Object.fromEntries(agents.map((a) => [a, { path: startScriptPath(folder, a, p), copy: copyCommand(a, folder, "/Users/a", p), script: startScript(a, folder, p) }])),
								},
							]),
						)
					: null,
			};
		});
	},
	"old setup": () => {
		const tomls = [
			'model = "x"\n\n[mcp_servers.godspeed]\nurl = "http://127.0.0.1:47613/api/mcp"\n\n[mcp_servers.godspeed.tools]\na = 1\n\n[other]\nb = 2\n',
			'[mcp_servers.godspeed]\ncommand = "node"\n',
			'model = 1\n',
			'[mcp_servers."godspeed"]\nurl = "http://x/api/mcp"\n\n\n\n[mcp_servers.godspeed.tools.a]\nx = 1\n[mcp_servers.other]\nurl = "u"\n',
			'  [ mcp_servers.godspeed ]\n  url = "http://127.0.0.1:1/api/mcp"\n[[mcp_servers.godspeed.extra]]\nz = 1\n[keep]\nk = 1\n\n\n\n\n[end]\n',
			'[mcp_servers.godspeed]\nurl = "http://x/other"\n',
			"",
			'[mcp_servers.godspeed]\nurl = "http://x/api/mcp"',
			'a = 1\r\n[mcp_servers.godspeed]\r\nurl = "http://x/api/mcp"\r\n[b]\r\n',
		];
		const jsons: [string, string[]][] = [
			['{"plugins":{"godspeed@godspeed":true,"b":1},"c":2}', ["plugins", "godspeed@godspeed"]],
			['{"plugins":{"godspeed@godspeed":true,"b":1},"c":2}', ["plugins", "x"]],
			["not json", ["a"]],
			['{"a":[1]}', ["a", "0"]],
			['{"a":{"b":{"c":1,"d":[1,2]}}}', ["a", "b", "c"]],
			['{"a":null}', ["a", "b"]],
			['{"a":1}', ["a"]],
			["[]", ["a"]],
			['{"a":1,"2":3,"1":4}', ["a"]],
			["", ["a"]],
			['{"é":"😀","x":[1]}', ["x"]],
		];
		return { toml: tomls.map((toml) => ({ toml, output: withoutOldCodexServer(toml) })), json: jsons.map(([text, keys]) => ({ text, keys, output: withoutJsonEntry(text, keys as never) })) };
	},

	// ── today's note ──
	"time labels": () => ({
		instants: INSTANTS.map((iso) => {
			const now = new Date(iso);
			return { iso, wall: wallClock(now, ZONE), zone: timeZoneLabel(now, ZONE), local: localDay(now.getTime()) };
		}),
		days: ["2026-10-30", "2026-11-01", "2026-02-29", "2026-13-30", "2026-00-10", "0099-01-01", "junk", "", "2026-1-5", "2026-10-30-5", "+2026-10-30", "2026-10-0"].map((day) => ({ day, output: dayLabel(day) })),
		clocks: ["23:59", "00:05", "12:00", "12:30:59", "00:00", "11:59", "13:00", "9:5", "24:00", "x:y", "", "07:07"].map((time) => ({ time, output: clockLabel(time) })),
		whens: [{ date: "2026-10-30" }, { date: "2026-10-30", time: "09:30" }, { date: "2026-11-01", time: "01:30" }, { date: "2026-11-01", time: "" }, { date: "2026-11-01", time: "00:00" }].map((deadline) => ({ deadline, output: whenLabel(deadline) })),
		zones: [ZONE, "UTC", "Asia/Kolkata", "Europe/London", "Nowhere/Land"].map((zone) => ({ zone, label: timeZoneLabel(new Date("2026-11-10T12:00:00.000Z"), zone) })),
	}),
	"today note": () =>
		INSTANTS.flatMap((iso) =>
			noteClasses.map((cls, i) => ({ iso, class: i, cls, output: todayNoteText({ now: new Date(iso), timeZone: ZONE, cls: cls as never }) })),
		),
	"today note append": () => {
		const note = (text: string, day: string) => ({ id: "m1", role: "custom", customType: "today-context", content: text, display: false, details: { day }, timestamp: 1 });
		const compaction = (firstKeptMessageId: string) => ({ id: "c1", role: "custom", customType: "compaction", content: "summary", display: true, details: { firstKeptMessageId }, timestamp: 2 });
		const user = (id: string) => ({ id, role: "user", content: "hi", timestamp: 3 });
		const text = "[Today] Fri Oct 30 2026, 12:00 PM (Pacific Time)\n\nComing up in this class (not marked done):\n- Midterm (exam), Mon Nov 2, in 3 days.";
		const sameDay = "[Today] Fri Oct 30 2026, 1:00 PM (Pacific Time)\n\nComing up in this class (not marked done):\n- Midterm (exam), Mon Nov 2, in 3 days.";
		const otherPart = "[Today] Fri Oct 30 2026, 12:00 PM (Pacific Time)\n\nsomething else";
		const cases: { messages: unknown[]; text: string; day: string }[] = [
			{ messages: [], text, day: "2026-10-30" },
			{ messages: [user("u1")], text, day: "2026-10-30" },
			{ messages: [user("u1"), note(text, "2026-10-30")], text: sameDay, day: "2026-10-30" },
			{ messages: [user("u1"), note(text, "2026-10-30")], text: sameDay, day: "2026-10-31" },
			{ messages: [user("u1"), note(text, "2026-10-30")], text: otherPart, day: "2026-10-30" },
			{ messages: [note(text, "2026-10-30"), user("u1"), compaction("u1")], text, day: "2026-10-30" },
			{ messages: [user("u0"), note(text, "2026-10-30"), user("u1"), compaction("u1")], text, day: "2026-10-30" },
			{ messages: [user("u0"), note(text, "2026-10-30"), user("u1"), compaction("u0")], text, day: "2026-10-30" },
			{ messages: [user("u0"), note(text, "2026-10-30"), user("u1"), compaction("missing")], text, day: "2026-10-30" },
			{ messages: [user("u0"), note(text, "2026-10-30"), compaction("u0")], text: "[Today] only the head", day: "2026-10-30" },
			{ messages: [note("[Today] only the head", "2026-10-30")], text: "[Today] only the head", day: "2026-10-30" },
		];
		return cases.map((c) => {
			const out = todayNoteToAppend(c.messages as never, c.text, c.day) as Record<string, unknown> | null;
			const { id: _id, timestamp: _timestamp, ...rest } = out ?? {};
			return { ...c, deadlinePart: deadlinePartOf(c.text), output: out ? rest : null };
		});
	},

	// ── the briefing ──
	briefing: () => {
		const full = briefing(100000, "2026-11-10T12:00:00.000Z");
		const length = full.output.length;
		const cuts = [length - 1, length - 80, length - 200, length - 400, 1500, 1200, 900, 700, 500, 300, 100, 0].filter((n) => n >= 0);
		return [
			full,
			...cuts.map((max) => briefing(max, "2026-11-10T12:00:00.000Z")),
			briefing(100000, "2026-11-01T09:30:00.000Z"),
			briefing(100000, "2026-11-02T07:59:00.000Z"),
			briefing(100000, "2026-11-10T12:00:00.000Z", { classes: [], lessons: [], notes: [] }),
			briefing(100000, "2026-11-10T12:00:00.000Z", { classes: [briefingClasses[2]], lessons: [], notes: [] }),
			briefing(100000, "2026-11-10T12:00:00.000Z", { lessons: [{ id: "bad", title: "Bad time", updatedAt: "soon", waiting: false }] }),
			briefing(100000, "2026-11-10T12:00:00.000Z", { notes: [{ id: "note_x", text: "bad", createdAt: "yesterday" }] }),
		];
	},

	// ── deadline requests ──
	"deadline requests": () => {
		const asks = [new Set<string>(), new Set(["d4", "h1"])];
		const found = asks.map((asked) => ({ asked: [...asked], today: "2026-11-10", found: unlinkedDeadlines(requestClasses as never, "2026-11-10", asked) }));
		const all = found[0]!.found;
		const now = Date.parse("2026-11-10T12:00:00.000Z");
		const talks = [null, undefined, { updatedAt: "2026-11-10T11:55:00.000Z", messages: [] }, { updatedAt: "2026-11-10T11:55:00.000Z", messages: [{}] }, { updatedAt: "2026-11-10T11:50:00.000Z", messages: [{}] }, { updatedAt: "2026-11-10T11:49:59.999Z", messages: [{}] }, { updatedAt: "junk", messages: [{}] }, { updatedAt: "2026-11-10T13:00:00.000Z", messages: [{}] }];
		const strip = (m: Record<string, unknown>) => {
			const { id: _id, timestamp: _timestamp, ...rest } = m;
			return rest;
		};
		const requests = [all.slice(0, 1), all.slice(0, 2), all, [], all.slice(-1)].map((deadlines) => ({ deadlines, output: strip(coverageRequest(deadlines) as never) }));
		return {
			classes: requestClasses,
			found,
			talks: talks.map((talk) => ({ talk, now, quiet: talkQuiet(talk as never, now) })),
			requests,
			asked: requests.map((r) => {
				const messages = [{ role: "user", content: "x" }, { ...coverageRequest(r.deadlines), id: "m1", timestamp: 1 }, { role: "custom", customType: "other", details: { deadlines: [{ id: "zz" }] } }];
				return { messages, ids: [...askedDeadlineIds(messages as never)] };
			}),
		};
	},
};
