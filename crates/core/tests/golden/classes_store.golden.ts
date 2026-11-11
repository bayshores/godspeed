// The class store on disk: what each call answers and leaves in class.json. The scenario runs
// with a clock that moves 10 seconds a step, and every time it makes and every id it mints
// are masked to the step or the order they appeared in, so the Rust store can run the same
// steps on its own clock. The fixture case reads the two made-up classes in tests/fixtures/classes.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PATHS } from "../../../../src/backend/config.ts";
import { classStore } from "../../../../src/backend/store/classes.ts";
import { subscribe } from "../../../../src/shared/core/events.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, "../fixtures/classes");
const FIXTURE_IDS = ["cls_cvq4t7in_101dfecb", "cls_cvq4t7n0_31e7df8c"];
const FIXTURE_NOW = Date.UTC(2026, 10, 10);
const T0 = Date.UTC(2030, 0, 1);
const STEP_MS = 10_000;

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const mutablePaths = PATHS as { classes: string };

const RealDate = Date;
let fakeNow = RealDate.now();
class FakeDate extends RealDate {
	constructor(...args: [] | [string | number | Date]) {
		super(...((args.length === 0 ? [fakeNow] : args) as [number]));
	}
	static override now(): number {
		return fakeNow;
	}
}

/** Runs `body` with the store over a fresh folder and the clock stopped at `at`. */
function inFolder<T>(body: (dir: string, setNow: (at: number) => void) => T, at = T0): T {
	const saved = mutablePaths.classes;
	const savedError = console.error;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "classes-golden-"));
	mutablePaths.classes = dir;
	console.error = () => {};
	globalThis.Date = FakeDate as DateConstructor;
	fakeNow = at;
	try {
		return body(dir, (t) => (fakeNow = t));
	} finally {
		globalThis.Date = RealDate;
		console.error = savedError;
		mutablePaths.classes = saved;
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

const file = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
	id, origin: "copied", name, path: `/data/${name}`, kind: "study", contentFp: "fp", status: "ready", addedAt: "2026-10-01T00:00:00.000Z", ...extra,
});
const manyProblems = Array.from({ length: 61 }, (_, i) => ({ number: String(i + 1), text: "t" }));
const exam = { kind: "exam", name: "x", date: "2026-11-04" };
const OLD = "2020-01-01T00:00:00.000Z";

type Step = { op: string; as?: string; id?: string; deadline?: string; dir?: string; text?: string; init?: unknown; patch?: unknown; files?: unknown[]; removed?: unknown[] };

const steps: Step[] = [
	{ op: "list" },
	{ op: "create", init: { name: "  CSE   21 ", description: " Discrete math\n", signature: { kind: "text", value: "Count" }, icon: "cpu" }, as: "A" },
	{ op: "create", init: { name: "   " }, as: "B" },
	{ op: "create", init: { name: `a${"😀".repeat(70)}`, description: "x" }, as: "C" },
	{ op: "get", id: "$A" },
	{ op: "list" },
	{ op: "records" },
	{ op: "update", id: "$A", patch: {} },
	{ op: "update", id: "$A", patch: { note: { text: "first", at: OLD } } },
	{ op: "update", id: "$A", patch: { name: "  CSE 21 \n renamed ", description: "  new  ", archived: true } },
	{ op: "update", id: "$A", patch: { linkedFolder: "/x/y", icon: "book-open", signature: { kind: "math", value: "x^2" } } },
	{ op: "update", id: "$A", patch: { rules: ["Be brief", "  ", 5, "Be brief", "Use   examples"] } },
	{ op: "update", id: "$A", patch: { icon: "nonsense" } },
	{ op: "get", id: "$A" },
	{ op: "update", id: "$A", patch: { linkedFolder: null, signature: null, rules: [], archived: false } },
	{ op: "update", id: "cls_nope", patch: { name: "x" } },
	{ op: "update", id: "bad", patch: {} },
	{
		op: "saveFiles",
		id: "$A",
		files: [file("f1", "Lecture 1.pdf"), file("f2", "Lecture 2.pdf", { foundByScan: true, addedAt: "2026-10-03T00:00:00.000Z" }), file("f3", "HW1.pdf", { kind: "info" }), file("f4", "notes.txt", { origin: "linked", path: "/Drive/notes.txt" }), { id: "broken" }],
		removed: [{ id: "gone", name: "Old.pdf", at: "$now" }, { id: "older", name: "Older.pdf", at: OLD }],
	},
	{ op: "get", id: "$A" },
	{ op: "list" },
	{ op: "saveFiles", id: "cls_nope", files: [] },
	{ op: "add", id: "$A", init: { kind: "exam", name: "  Midterm   1 ", date: "2026-11-04", time: "18:30", fileIds: ["f1", "f2", "f1"], leftOutIds: ["f3"], source: "  syllabus \n p2  " }, as: "d1" },
	{ op: "add", id: "$A", init: { kind: "homework", name: "HW 1", date: "2026-11-02", assignmentFileId: "f3" }, as: "d2" },
	{ op: "add", id: "$A", init: { kind: "quiz", name: "Quiz", date: "2026-11-04", time: "09:00" }, as: "d3" },
	{ op: "add", id: "$A", init: { kind: "project", name: "Proj", date: "2026-12-01" }, as: "d4" },
	{ op: "add", id: "$A", init: { ...exam, name: "   " } },
	{ op: "add", id: "$A", init: { ...exam, kind: "test" } },
	{ op: "add", id: "$A", init: { ...exam, date: "2026-02-30" } },
	{ op: "add", id: "$A", init: { ...exam, time: "25:00" } },
	{ op: "add", id: "$A", init: { ...exam, fileIds: ["nope", "f1"] } },
	{ op: "add", id: "$A", init: { ...exam, fileIds: "f1" } },
	{ op: "add", id: "$A", init: { ...exam, source: 5 } },
	{ op: "add", id: "$A", init: { ...exam, assignmentFileId: "nope" } },
	{ op: "add", id: "cls_nope", init: exam },
	{ op: "get", id: "$A" },
	{ op: "updateDeadline", id: "$A", deadline: "$d1", patch: { done: true } },
	{ op: "updateDeadline", id: "$A", deadline: "$d1", patch: { done: true, name: "Midterm 1" } },
	{ op: "updateDeadline", id: "$A", deadline: "$d1", patch: { time: null, source: null, name: "Midterm one", date: "2026-11-05" } },
	{ op: "updateDeadline", id: "$A", deadline: "$d1", patch: { done: false } },
	{ op: "updateDeadline", id: "$A", deadline: "$d2", patch: { assignmentFileId: null, problems: [{ number: " 1 ", title: "", text: " Show it ", page: 3, done: true }, { number: "2", title: "  Two   parts ", text: "t", page: 0 }] } },
	{ op: "updateDeadline", id: "$A", deadline: "$d2", patch: { problems: [{ number: "1", text: "a" }, { number: "1", text: "b" }] } },
	{ op: "updateDeadline", id: "$A", deadline: "$d2", patch: { problems: [{ number: "1", text: " " }] } },
	{ op: "updateDeadline", id: "$A", deadline: "$d2", patch: { problems: manyProblems } },
	{ op: "updateDeadline", id: "$A", deadline: "$d2", patch: { problems: [5] } },
	{ op: "updateDeadline", id: "$A", deadline: "$d2", patch: { problems: "none" } },
	{ op: "updateDeadline", id: "$A", deadline: "$d3", patch: { fileIds: ["f1", "f2"] } },
	{ op: "updateDeadline", id: "$A", deadline: "$d3", patch: { leftOutIds: ["f1"] } },
	{ op: "updateDeadline", id: "$A", deadline: "$d3", patch: { fileIds: ["f1", "f2"], leftOutIds: ["f2"] } },
	{ op: "updateDeadline", id: "$A", deadline: "$d3", patch: { fileIds: ["f1"] } },
	{ op: "updateDeadline", id: "$A", deadline: "$d4", patch: { kind: "quiz", assignmentFileId: "f2" } },
	{ op: "updateDeadline", id: "$A", deadline: "nope", patch: {} },
	{ op: "updateDeadline", id: "$A", deadline: "$d4", patch: { kind: "x" } },
	{ op: "updateDeadline", id: "$A", deadline: "$d4", patch: { date: "soon" } },
	{ op: "updateDeadline", id: "$A", deadline: "$d4", patch: { time: "9am" } },
	{ op: "updateDeadline", id: "$A", deadline: "$d4", patch: { name: " " } },
	{ op: "updateDeadline", id: "$A", deadline: "$d4", patch: { source: 5 } },
	{ op: "updateDeadline", id: "$A", deadline: "$d4", patch: { fileIds: ["zzz"] } },
	{ op: "updateDeadline", id: "cls_nope", deadline: "$d4", patch: {} },
	{ op: "get", id: "$A" },
	{ op: "saveFiles", id: "$A", files: [file("f2", "Lecture 2.pdf"), file("f4", "notes.txt", { origin: "linked", path: "/Drive/notes.txt" })], removed: [{ id: "f1", name: "Lecture 1.pdf", at: "$now" }] },
	{ op: "get", id: "$A" },
	{ op: "removeDeadline", id: "$A", deadline: "$d4" },
	{ op: "removeDeadline", id: "$A", deadline: "$d4" },
	{ op: "removeDeadline", id: "cls_nope", deadline: "$d4" },
	{ op: "get", id: "$A" },
	{ op: "delete", id: "$B" },
	{ op: "delete", id: "$B" },
	{ op: "delete", id: "bad" },
	{ op: "raw", dir: "cls_raw1_00000001", text: "{not json" },
	{ op: "raw", dir: "cls_raw2_00000002", text: JSON.stringify({ id: "cls_raw2_00000002", name: "Newer", createdAt: OLD, updatedAt: OLD, version: 99 }) },
	{
		op: "raw",
		dir: "cls_raw3_00000003",
		text: JSON.stringify({ id: "cls_raw3_00000003", name: "Old format", createdAt: OLD, updatedAt: "2020-02-02T00:00:00.000Z", version: 2, files: [file("f9", "a.pdf")], exams: [{ id: "e1", name: "Final", date: "2025-12-01", fileIds: ["f9", "f10"] }, { id: 1 }], archived: "yes", linkedFolder: 5 }),
	},
	{ op: "raw", dir: "cls_raw4_00000004", text: JSON.stringify([1, 2]) },
	{ op: "get", id: "cls_raw1_00000001" },
	{ op: "get", id: "cls_raw2_00000002" },
	{ op: "get", id: "cls_raw3_00000003" },
	{ op: "get", id: "cls_raw4_00000004" },
	{ op: "list" },
	{ op: "update", id: "cls_raw3_00000003", patch: { name: "Renamed" } },
	{ op: "delete", id: "$A" },
	{ op: "list" },
];

function resolve(value: unknown, aliases: Map<string, string>): unknown {
	if (typeof value === "string") return value === "$now" ? new Date().toISOString() : (aliases.get(value) ?? value);
	if (Array.isArray(value)) return value.map((v) => resolve(v, aliases));
	if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, aliases)]));
	return value;
}

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;

/** Every id replaced by its alias and every step time by its step number. */
function mask(value: unknown, names: Map<string, string>): unknown {
	if (typeof value === "string") {
		let text = value;
		for (const [real, alias] of names) text = text.replaceAll(real, alias);
		return text.replace(ISO, (iso) => {
			const k = (Date.parse(iso) - T0) / STEP_MS;
			return Number.isInteger(k) && k >= 0 && k < steps.length ? `<t${k}>` : iso;
		});
	}
	if (Array.isArray(value)) return value.map((v) => mask(v, names));
	if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [mask(k, names), mask(v, names)]));
	return value;
}

function outcome(run: () => unknown) {
	try {
		return { ok: run() ?? null };
	} catch (err) {
		const code = (err as { code?: unknown }).code;
		return { error: (err as Error).message, ...(typeof code === "string" ? { code } : {}) };
	}
}

function runScenario() {
	return inFolder((dir, setNow) => {
		let events = 0;
		const stop = subscribe((e) => {
			if (e.type === "classes-changed") events++;
		});
		const aliases = new Map<string, string>();
		const names = new Map<string, string>();
		const counts: Record<string, number> = { cls: 0, ddl: 0 };
		const learn = (real: string, kind: "cls" | "ddl") => names.set(real, `<${kind}${++counts[kind]!}>`);
		const log = steps.map((raw, k) => {
			setNow(T0 + k * STEP_MS);
			events = 0;
			const step = resolve(raw, aliases) as Step;
			const id = step.id!;
			let result = outcome(() => {
				switch (step.op) {
					case "list":
						return classStore.listClasses();
					case "records":
						return classStore.listClassRecords();
					case "create":
						return classStore.createClass(step.init as never);
					case "get":
						return classStore.getClass(id);
					case "update":
						return classStore.updateClass(id, step.patch as never);
					case "saveFiles":
						return classStore.saveFiles(id, step.files as never, step.removed as never);
					case "add":
						return classStore.addDeadline(id, step.init as never);
					case "updateDeadline":
						return classStore.updateDeadline(id, step.deadline!, step.patch as never);
					case "removeDeadline":
						return classStore.removeDeadline(id, step.deadline!);
					case "delete":
						return classStore.deleteClass(id);
					case "raw":
						fs.mkdirSync(path.join(dir, step.dir!), { recursive: true });
						fs.writeFileSync(path.join(dir, step.dir!, "class.json"), step.text!);
						return step.dir;
					default:
						throw new Error(`unknown op ${step.op}`);
				}
			});
			const made = (result as { ok?: { id?: string } }).ok;
			if (step.op === "raw") learn(step.dir!, "cls");
			if (step.as && made?.id) {
				aliases.set(`$${step.as}`, made.id);
				learn(made.id, step.op === "add" ? "ddl" : "cls");
			}
			const disk = fs.existsSync(dir)
				? fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, "class.json"))).map((n) => [n, fs.readFileSync(path.join(dir, n, "class.json"), "utf8")] as const)
				: [];
			const masked = mask({ step: k, op: step.op, outcome: result, events, disk: Object.fromEntries(disk) }, names) as { disk: Record<string, string> };
			masked.disk = Object.fromEntries(Object.entries(masked.disk).sort(([a], [b]) => (a < b ? -1 : 1)));
			return masked;
		});
		stop();
		return { steps, log };
	});
}

function fixtureReads() {
	return inFolder(
		(dir) => {
			const read = (id: string) => fs.readFileSync(path.join(FIXTURES, id, "class.json"), "utf8");
			for (const id of FIXTURE_IDS) {
				fs.mkdirSync(path.join(dir, id), { recursive: true });
				fs.writeFileSync(path.join(dir, id, "class.json"), read(id));
			}
			const classes = FIXTURE_IDS.map((id) => {
				const record = classStore.getClass(id)!;
				classStore.updateClass(id, {});
				const written = fs.readFileSync(path.join(dir, id, "class.json"), "utf8");
				return {
					id,
					fixtureSha: sha(read(id)),
					recordSha: sha(JSON.stringify(record)),
					keys: Object.keys(record),
					files: record.files.length,
					removedFiles: record.removedFiles?.length ?? 0,
					deadlines: record.deadlines,
					summary: classStore.listClasses().find((c) => c.id === id),
					writtenSha: sha(written),
					writtenLength: written.length,
					sameAsFixture: written === read(id),
				};
			});
			return { now: new Date(FIXTURE_NOW).toISOString(), classes, order: classStore.listClasses().map((c) => c.id) };
		},
		FIXTURE_NOW,
	);
}

export default {
	"store scenario": runScenario,
	"fixture classes": fixtureReads,
};
