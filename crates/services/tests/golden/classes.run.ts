// Runs the classes package's TypeScript over three synthetic classes in a fresh folder and prints
// what it answered and made. classes.golden.ts starts it in its own process with LH_DATA_DIR set,
// because the stores fix their folders when they load. Paths inside the folder read "<root>".
import fs from "node:fs";
import path from "node:path";

const DATA = process.env.LH_DATA_DIR;
if (!DATA) throw new Error("LH_DATA_DIR must be set");
const ROOT = path.dirname(DATA);
console.error = () => {};

const AT = "2026-01-05T10:00:00.000Z";
const file = (id: string, origin: "linked" | "copied", name: string, rel: string, extra: Record<string, unknown> = {}) => ({
	id, origin, name, path: rel, kind: "study", contentFp: "", status: "done", addedAt: AT, ...extra,
});
const A = "cls_golden_a";
const B = "cls_golden_b";
const C = "cls_golden_c";
const records = [
	{
		id: A, name: "Linear Algebra", description: "Vectors and matrices", createdAt: AT, updatedAt: AT, archived: false,
		linkedFolder: path.join(ROOT, "linked", "la"),
		files: [
			file("f_a00000000001", "linked", "notes.md", "week1/notes.md"),
			file("f_a00000000002", "linked", "Lecture 3.mp4", "Lecture 3.mp4"),
			file("f_a00000000003", "linked", "Lecture 4.mp4", "Lecture 4.mp4", { transcriptId: "f_a00000000004" }),
			file("f_a00000000004", "linked", "Lecture 4.vtt", "Lecture 4.vtt"),
			file("f_a00000000005", "copied", "syllabus.pdf", "f_a00000000005/syllabus.pdf", { kind: "info", status: "failed" }),
			file("f_a00000000006", "linked", "gone.txt", "gone.txt"),
			file("f_a00000000007", "linked", "Lecture 5.mp4", "Lecture 5.mp4"),
			file("f_a00000000008", "linked", "Week 2 notes.md", "week2/Week 2 notes.md", { status: "pending" }),
		],
		deadlines: [],
		version: 7,
	},
	{
		id: B, name: "Linear Algebra", description: "Last year's", createdAt: AT, updatedAt: AT, archived: true,
		files: [file("f_b00000000001", "copied", "notes.md", "f_b00000000001/notes.md"), file("f_b00000000002", "linked", "lost.txt", "lost.txt")],
		deadlines: [],
		version: 7,
	},
	{ id: C, name: "Physics: Waves/Optics", description: "", createdAt: AT, updatedAt: AT, archived: false, files: [], deadlines: [], version: 7 },
];
const files = [
	["linked/la/week1/notes.md", "# Week 1\n"],
	["linked/la/Lecture 3.mp4", "not really a video"],
	["linked/la/Lecture 4.mp4", "not really a video"],
	["linked/la/Lecture 4.vtt", "WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n"],
	["linked/la/Lecture 5.mp4", "not really a video"],
	["linked/la/week2/Week 2 notes.md", "# Week 2\n"],
	[`data/classes/${A}/files/f_a00000000005/syllabus.pdf`, "%PDF-1.4 not really"],
	[`data/classes/${A}/files/transcripts/f_a00000000002.txt`, "Hello from lecture 3\n"],
	[`data/classes/${B}/files/f_b00000000001/notes.md`, "# Old notes\n"],
];
for (const record of records) {
	const at = path.join(DATA, "classes", record.id, "class.json");
	fs.mkdirSync(path.dirname(at), { recursive: true });
	fs.writeFileSync(at, `${JSON.stringify(record, null, "\t")}\n`);
}
for (const [rel, text] of files) {
	fs.mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true });
	fs.writeFileSync(path.join(ROOT, rel), text);
}

const { classCardFor } = await import("../../../../src/backend/server/class-card.ts");
const { syncShortcuts } = await import("../../../../src/backend/server/class-shortcuts.ts");
const { sourceIdFor } = await import("../../../../src/backend/server/classes.ts");
const { classActions, folderName } = await import("../../../../src/backend/server/class-actions.ts");
const { stores } = await import("../../../../src/backend/server/stores.ts");

const mask = (v: unknown): unknown => JSON.parse(JSON.stringify(v).split(ROOT).join("<root>"));

/** Everything under `dir`: folders, links (with their targets) and files (with their text). */
function tree(dir: string): unknown[] {
	const out: unknown[] = [];
	const walk = (at: string) => {
		for (const name of fs.readdirSync(at)) {
			const p = path.join(at, name);
			const st = fs.lstatSync(p);
			const rel = path.relative(dir, p);
			if (st.isSymbolicLink()) out.push({ path: rel, type: "link", target: fs.readlinkSync(p) });
			else if (st.isDirectory()) {
				out.push({ path: rel, type: "dir" });
				walk(p);
			} else out.push({ path: rel, type: "file", text: fs.readFileSync(p, "utf8") });
		}
	};
	if (fs.existsSync(dir)) walk(dir);
	return mask(out) as unknown[];
}

const writable = () =>
	[`data/classes/${A}/files/f_a00000000005/syllabus.pdf`, `data/classes/${B}/files/f_b00000000001/notes.md`].map((rel) => ({
		path: rel,
		writable: (fs.statSync(path.join(ROOT, rel)).mode & 0o222) !== 0,
	}));

const out: Record<string, unknown> = { before: mask({ records, files }) };
out.sourceIds = [[A, "f_a00000000001"], [B, "f_b00000000002"], ["cls_x", "f_000000000000"], ["", ""]].map(([c, f]) => [c, f, sourceIdFor(c!, f!)]);
out.folderNames = [undefined, "", "/", "/Users/x/Drive/Math 20C", "/Users/x/Drive/Math 20C/", "C:\\Users\\x\\Math\\", "a\\b/c//", "plain"].map((p) => [p ?? null, folderName(p)]);
out.cards = mask([A, B, C].map((id) => classCardFor(stores.classStore.getClass(id)!)));
const actions = classActions(undefined, async () => new Response(), { openStarted: false });
out.tools = mask({
	list: actions.list_classes({}),
	readA: actions.read_class({ class_id: A }),
	readC: actions.read_class({ class_id: C }),
	readMissing: actions.read_class({ class_id: "cls_missing" }),
});

const G = path.join(ROOT, "gs");
const steps: unknown[] = [];
syncShortcuts(G);
steps.push({ step: "first sync", tree: tree(G), copies: writable() });
fs.rmSync(path.join(ROOT, "linked/la/week1/notes.md"));
fs.writeFileSync(path.join(G, "classes", "mine.txt"), "the learner's own file\n");
syncShortcuts(G);
steps.push({ step: "a file gone, a learner file added", tree: tree(G) });
syncShortcuts(G, { clear: true });
steps.push({ step: "cleared", tree: tree(G) });
out.shortcuts = steps;

process.stdout.write(JSON.stringify(out));
process.exit(0);
