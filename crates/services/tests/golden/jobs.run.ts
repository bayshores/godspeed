// Runs the jobs package's TypeScript (jobs.ts, observability.ts) over a fresh data folder with
// synthetic lessons and job records, and prints what it answered and left on disk. jobs.golden.ts
// starts it in its own process with LH_DATA_DIR set, because the job store fixes its folder when
// it loads. Job records a step changed carry "<now>" for updatedAt (the Rust clock is not fixed).
import fs from "node:fs";
import path from "node:path";

const which = process.argv[2];
const DATA = process.env.LH_DATA_DIR;
if (!DATA) throw new Error("LH_DATA_DIR must be set");
const NOW = Date.UTC(2030, 0, 1, 12);
const RealDate = Date;
class FakeDate extends RealDate {
	constructor(...args: [] | [string | number | Date]) {
		super(...((args.length === 0 ? [NOW] : args) as [number]));
	}
	static override now(): number {
		return NOW;
	}
}
globalThis.Date = FakeDate as DateConstructor;
console.error = () => {};

const ago = (ms: number) => new RealDate(NOW - ms).toISOString();
const tabs = (v: unknown) => `${JSON.stringify(v, null, "\t")}\n`;
const lesson = (id: string, title: string | undefined, updatedAt: string) => ({
	id, ...(title === undefined ? {} : { title }), createdAt: "2029-12-31T00:00:00.000Z", updatedAt, messages: [], kind: "study", version: 1,
});
const job = (id: string, chatId: string, fields: Record<string, unknown>) => ({
	id, kind: "research", chatId, toolCallId: `call_${id}`, input: { question: "Why?" }, status: "running", activity: "researching",
	createdAt: "2029-12-31T23:00:00.000Z", updatedAt: ago(120_000), ...fields,
});

const L1 = "chat_golden01_00000001";
const L2 = "chat_golden02_00000002";
const L3 = "chat_golden03_00000003";
const GONE = "chat_golden09_00000009";
const OFF = "chat_golden08_00000008"; // no lesson file: the sweep leaves its jobs alone
const delivered = { kind: "result", status: "delivered" };
const outside = { model: "agent:outside-agent", inputTokens: 10, outputTokens: 2, steps: 1 };

const fixtures = {
	feed: {
		chats: [lesson(L1, "Binary search", ago(1_000)), lesson(L2, undefined, ago(2_000)), lesson(L3, "Sorting", ago(3_000))],
		jobs: [
			job("job_feed0001_00000001", L1, { status: "running", activity: "web_fetch: example.org", result: { brief: "ok", sources: [] }, delivery: delivered, usage: outside, updatedAt: ago(30_000) }),
			job("job_feed0002_00000002", L2, { kind: "demo", result: { html: "<p>x</p>" }, delivery: delivered, usage: { ...outside, model: "other:model" }, updatedAt: ago(60_000) }),
			job("job_feed0003_00000003", L3, { kind: "visual", result: { svg: "<svg/>" }, delivery: delivered, updatedAt: ago(30_000) }),
			job("job_feed0004_00000004", GONE, { result: { brief: "x", sources: [] }, delivery: delivered, updatedAt: ago(10_000) }),
			job("job_feed0005_00000005", L1, { status: "error", activity: "failed", error: "  Spaced  ", delivery: delivered, updatedAt: ago(90_000) }),
			job("job_feed0006_00000006", L2, { status: "error", activity: "failed", error: "   ", delivery: delivered, updatedAt: ago(30_000) }),
			job("job_feed0007_00000007", L3, { status: "error", activity: "failed", delivery: delivered, updatedAt: ago(599_999) }),
			job("job_feed0008_00000008", L3, { status: "error", activity: "failed", error: "Too old", delivery: delivered, updatedAt: ago(600_000) }),
			job("job_feed0009_00000009", L1, { status: "error", activity: "failed", error: "Bad time", delivery: delivered, updatedAt: "not a date" }),
			job("job_feed0010_00000010", L1, { status: "done", activity: "finished", result: { brief: "done", sources: [] }, delivery: delivered, updatedAt: ago(5_000) }),
			// The sweep finishes a running job that already holds its result.
			job("job_feed0011_00000011", L2, { result: { brief: "Research failed: offline", sources: [] } }),
			job("job_feed0012_00000012", L3, { kind: "pdf", result: { brief: "Pages 1-2 say so." } }),
			// The sweep leaves a running job of an unlisted lesson alone.
			job("job_feed0013_00000013", OFF, { result: { brief: "x", sources: [] } }),
			// A pending delivery of a listed lesson is restored (its record stays as it is).
			job("job_feed0014_00000014", L1, { status: "done", activity: "finished", result: { brief: "y", sources: [] }, delivery: { kind: "result", status: "pending" }, updatedAt: ago(40_000) }),
		],
		runs: [
			{ chatId: L1, kind: "chat", phase: "extracting", startedAt: NOW - 5_000 },
			{ chatId: "src_notes001", kind: "notes", label: "notes/week 1.md", part: { i: 2, n: 3 }, phase: "merging", startedAt: NOW - 9_000 },
			{ chatId: L2, kind: "chat", part: { i: 1, n: 2 }, phase: "waiting", startedAt: NOW - 1_000 },
			{ chatId: "topics:cls_x", kind: "topics", label: "Grouping topics", phase: "grouping", startedAt: NOW - 3_000 },
			{ chatId: "src_unknown01", kind: "notes", phase: "extracting", startedAt: NOW - 7_000 },
		],
	},
	records: {
		chats: [] as unknown[],
		jobs: [
			job("job_abrt0001_00000001", OFF, {}),
			job("job_abrt0002_00000002", OFF, { result: { brief: "Found it.", sources: [{ url: "https://example.org" }] } }),
			job("job_abrt0003_00000003", OFF, { kind: "demo", result: { title: "Stepper", notes: "no html" } }),
			job("job_abrt0004_00000004", OFF, { status: "done", activity: "finished", result: { brief: "ok", sources: [] }, delivery: delivered }),
			job("job_abrt0005_00000005", OFF, { status: "error", activity: "failed", error: "boom", delivery: delivered }),
			job("job_ackn0001_00000001", OFF, { status: "done", activity: "finished", result: { brief: "ok", sources: [] }, delivery: { kind: "result", status: "pending", note: "kept" } }),
			job("job_ackn0002_00000002", OFF, { kind: "visual", result: { notes: "nothing drawn" } }),
			job("job_ackn0003_00000003", OFF, { status: "error", activity: "aborted", error: "Aborted by learner", delivery: { kind: "abort", status: "delivered" } }),
			job("job_ackn0004_00000004", OFF, { status: "done", activity: "finished", result: { brief: "ok", sources: [] } }),
		],
	},
};

const set = which === "feed" ? fixtures.feed : fixtures.records;
fs.mkdirSync(path.join(DATA, "chats"), { recursive: true });
fs.mkdirSync(path.join(DATA, "jobs"), { recursive: true });
for (const chat of set.chats as { id: string }[]) fs.writeFileSync(path.join(DATA, "chats", `${chat.id}.json`), tabs(chat));
for (const j of set.jobs) fs.writeFileSync(path.join(DATA, "jobs", `${j.id}.json`), tabs(j));

const { abortJob, listAllJobs, noteSteersDurable } = await import("../../../../src/backend/server/jobs.ts");
const { activityFeed } = await import("../../../../src/backend/server/observability.ts");
const { runs } = await import("../../../../src/backend/agent/subagents/extraction-runs.ts");
const { chatStore } = await import("../../../../src/backend/store/chats.ts");

const before = new Map(set.jobs.map((j) => [j.id, j.updatedAt]));
/** A job's file as JSON, its updatedAt masked when the step changed it. */
const record = (id: string) => {
	const file = path.join(DATA, "jobs", `${id}.json`);
	if (!fs.existsSync(file)) return null;
	const j = JSON.parse(fs.readFileSync(file, "utf8"));
	if (j.updatedAt !== before.get(id)) j.updatedAt = "<now>";
	return j;
};
const records = () => set.jobs.map((j) => record(j.id));

const out: Record<string, unknown> = { before: { chats: set.chats, jobs: set.jobs } };
if (which === "feed") {
	for (const run of fixtures.feed.runs) runs().running.set(run.part ? `${run.chatId}#${run.part.i}` : run.chatId, { ...run, usage: {}, controller: new AbortController() } as never);
	const feed = activityFeed();
	out.sweep = records();
	out.compose = { now: NOW, chats: chatStore.listChats(), jobs: listAllJobs(), runs: fixtures.feed.runs, feed };
} else {
	const steps: unknown[] = [];
	for (const id of ["job_abrt0001_00000001", "job_abrt0002_00000002", "job_abrt0003_00000003", "job_abrt0004_00000004", "job_abrt0005_00000005", "job_missing0_00000000"]) {
		steps.push({ op: "abort", id, outcome: abortJob(id), job: record(id) });
	}
	const persisted = [
		{ id: "steer_job_ackn0001_00000001", role: "custom", customType: "subagent-steer", details: { jobId: "job_ackn0001_00000001" } },
		{ id: "steer_job_ackn0002_00000002", role: "custom", customType: "subagent-steer", details: { jobId: "job_ackn0002_00000002" } },
		{ id: "steer_job_ackn0003_00000003", role: "custom", customType: "subagent-abort", details: { jobId: "job_ackn0003_00000003" } },
		{ id: "msg_plain", role: "user", content: "hi", details: { jobId: "job_ackn0004_00000004" } },
		{ id: "steer_job_gone", role: "custom", customType: "subagent-steer", details: { jobId: "job_gone0000_00000000" } },
		{ id: "custom_no_job", role: "custom", customType: "space-context", details: {} },
	];
	noteSteersDurable(OFF, persisted as never);
	steps.push({ op: "acknowledge", chatId: OFF, persisted, jobs: records() });
	out.steps = steps;
}
process.stdout.write(JSON.stringify(out));
process.exit(0);
