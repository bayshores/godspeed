import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ActivityFeed, FeedExtraction } from "../../src/frontend/components/activity-dock.tsx";
import { agoLabel, blobLabel, formatElapsed, toBlobs } from "../../src/frontend/components/halley/activity-model.ts";
import { BackgroundJobs } from "../../src/frontend/components/halley/background-jobs.tsx";
import { formatTokens, pagesLabel } from "../../src/frontend/components/usage-format.ts";
import { agentWaiting, parseAgentStatus, sameAgentStatus, teachStep, waitingNotice, type AgentStatus } from "../../src/frontend/components/agent-status.tsx";

describe("the waiting-for-your-agent notice", () => {
	const status = (over: Partial<AgentStatus> = {}): AgentStatus => ({ connected: false, teaching: false, backupConnected: false, backupAnswering: false, pendingWork: 0, claimedLessons: [], ...over });
	it("shows only while work waits and no agent is teaching", () => {
		assert.equal(agentWaiting(status({ pendingWork: 1 })), true);
		assert.equal(agentWaiting(status({ connected: true, teaching: true, pendingWork: 1 })), false);
		assert.equal(agentWaiting(status({ connected: true, pendingWork: 1 })), true, "connected but not teaching still waits");
		assert.equal(agentWaiting(status()), false);
		assert.equal(agentWaiting(null), false);
	});
	it("says to open an agent from the teacher panel, or to tell the connected one to start", () => {
		assert.equal(waitingNotice(), "Waiting for your agent. Open your agent from the teacher panel.");
		assert.equal(waitingNotice("Claude Code"), "Waiting for your agent. Tell Claude Code to start teaching.");
		assert.equal(teachStep("Codex"), "Tell Codex to start teaching.");
	});
	it("reads the /api/mcp-access body", () => {
		assert.deepEqual(
			parseAgentStatus({ agentConnected: true, agentTeaching: true, agentName: "Claude Code", backupConnected: true, backupAnswering: "yes", pendingWork: 2, claimedLessons: [{ lessonId: "c1", claimedAt: "2026-10-30T12:00:00Z" }, { lessonId: 3 }] }),
			{ connected: true, teaching: true, name: "Claude Code", backupConnected: true, backupAnswering: false, pendingWork: 2, claimedLessons: [{ lessonId: "c1", claimedAt: "2026-10-30T12:00:00Z" }] },
		);
		assert.deepEqual(parseAgentStatus({ agentConnected: false, agentName: null }), status());
		assert.equal(parseAgentStatus(null), null);
	});
	it("a poll with the same status keeps the old one", () => {
		const s = status({ connected: true, teaching: true, name: "Claude Code", pendingWork: 2 });
		assert.equal(sameAgentStatus(s, { ...s }), true);
		assert.equal(sameAgentStatus(null, s), false);
		assert.equal(sameAgentStatus(s, { ...s, connected: false }), false);
		assert.equal(sameAgentStatus(s, { ...s, teaching: false }), false);
		assert.equal(sameAgentStatus(s, { ...s, name: "Codex" }), false);
		assert.equal(sameAgentStatus(s, { ...s, pendingWork: 3 }), false);
		assert.equal(sameAgentStatus(s, { ...s, backupConnected: true }), false);
		assert.equal(sameAgentStatus(s, { ...s, backupAnswering: true }), false);
		assert.equal(sameAgentStatus(s, { ...s, claimedLessons: [{ lessonId: "c1", claimedAt: "2026-10-30T12:00:00Z" }] }), false);
	});
	it("the background jobs show the notice text", () => {
		const html = renderToStaticMarkup(<BackgroundJobs feed={{ jobs: [], extractions: [] }} waiting={waitingNotice()} />);
		assert.ok(html.includes('data-testid="activity-waiting"'));
		assert.ok(html.includes(waitingNotice()));
		assert.ok(!renderToStaticMarkup(<BackgroundJobs feed={{ jobs: [], extractions: [] }} waiting={null} />).includes("activity-waiting"));
	});
});

// The section's pure layer: folds, formatting, and blob order — then the SSR
// render (blobs, "–" doctrine, the abort affordance, the always-present
// header — the sidebar's background-agents strip).

const NOW = Date.parse("2026-09-09T12:00:00Z");

/** A full CallUsage (its fields are undefined-valued, not optional). */
function step(inputTokens: number, outputTokens: number) {
	return { inputTokens, outputTokens, cacheReadTokens: undefined, cacheWriteTokens: undefined, reasoningTokens: undefined };
}

function job(over: Partial<ActivityFeed["jobs"][number]> = {}): ActivityFeed["jobs"][number] {
	return {
		id: "job-1",
		kind: "research",
		chatId: "c1",
		toolCallId: "t1",
		status: "running",
		activity: 'web_search: "sigma.js v3"',
		createdAt: new Date(NOW - 45_000).toISOString(),
		updatedAt: new Date(NOW - 1000).toISOString(),
		title: "Limits lesson",
		contextLimit: null,
		...over,
	};
}

describe("activity dock pure layer", () => {
	it("merges jobs + extractions oldest-first (the stable blob order)", () => {
		const feed: ActivityFeed = {
			jobs: [job({ id: "new", createdAt: new Date(NOW - 10_000).toISOString() })],
			extractions: [{ id: "cx", chatId: "cx", kind: "chat", title: "Old lesson", phase: "merging", startedAt: NOW - 100_000 }],
		};
		const blobs = toBlobs(feed);
		assert.equal(blobs.length, 2);
		const first = blobs[0]!;
		assert.equal(first.id, "cx"); // extraction started first
		assert.equal(first.process, "extraction");
		assert.equal(first.phase, "merging");
		assert.equal(first.opensLesson, true, "a lesson's own run links to it");
		assert.equal(blobs[1]!.id, "new");
	});

	it("per-chunk jobs: one source, N rows — unique ids (React keys), one chatId, part-suffixed titles", () => {
		const rows = [
			{ id: "src_a#1", chatId: "src_a", kind: "notes", part: { i: 1, n: 2 }, title: "notes.md (1/2)", phase: "extracting", startedAt: NOW - 1000 },
			{ id: "src_a#2", chatId: "src_a", kind: "notes", part: { i: 2, n: 2 }, title: "notes.md (2/2)", phase: "waiting", startedAt: NOW - 500 },
		] as FeedExtraction[];
		const blobs = toBlobs({ jobs: [], extractions: rows });
		assert.equal(blobs.length, 2, "one blob per chunk job");
		assert.deepEqual(blobs.map((b) => b.id), ["src_a#1", "src_a#2"], "unique row ids — no duplicate React keys");
		assert.ok(blobs.every((b) => b.chatId === "src_a"), "abort identity stays source-scoped");
		assert.ok(blobs.every((b) => !b.opensLesson), "a source id is no lesson: no link to a 404");
	});

	it("a failed job reads 'failed' with the runner's honest wording", () => {
		const crashed = job({ status: "error", activity: "failed", error: "FAILED: headless crashed" });
		const real = toBlobs({ jobs: [crashed], extractions: [] })[0]!;
		assert.equal(real.activity, "failed");
	});

	it("context line = LAST step's tokens vs the model limit, never a cumulative sum", () => {
		const base = {
			model: "openrouter:z-ai/glm-5.3-flash",
			inputTokens: 400_000, // running total (much bigger — must NOT feed the line)
			outputTokens: 8_000,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			reasoningTokens: 0,
			steps: 5,
		};
		const withLast = job({
			usage: { ...base, lastStep: step(90_000, 2_000) },
			// The amendment: the limit is the server's
			// live-catalog join riding the feed — the dock never resolves it.
			contextLimit: 131_072,
		});
		const blob = toBlobs({ jobs: [withLast], extractions: [] })[0]!;
		assert.equal(blob.context?.used, 92_000);
		assert.equal(blob.context?.limit, 131_072);
		// No lastStep yet (capture pending) → "–", even though usage exists.
		const stripped = toBlobs({ jobs: [job({ usage: { ...base } })], extractions: [] })[0]!;
		assert.equal(stripped.context, null);
		// Model missing from the live catalog (historical session,
		// package update) → the feed carries null → no context line.
		const uncatalogued = toBlobs({
			jobs: [job({ usage: { ...base, model: "nope/unknown", lastStep: step(5, 5), } })],
			extractions: [],
		})[0]!;
		assert.equal(uncatalogued.context, null);
		// The numerator is the same cache-inclusive fold the session meter
		// uses (context-meter audit): provider "input"
		// EXCLUDES cacheRead/cacheWrite, so input+output alone reads wildly
		// low on cache-heavy jobs — 10k+0.5k+120k+30k = 160.5k, not 10.5k.
		const cached = toBlobs({
			jobs: [
				job({
					usage: {
						...base,
						lastStep: {
							inputTokens: 10_000,
							outputTokens: 500,
							cacheReadTokens: 120_000,
							cacheWriteTokens: 30_000,
							reasoningTokens: undefined,
						},
					},
					contextLimit: 200_000,
				}),
			],
			extractions: [],
		})[0]!;
		assert.equal(cached.context?.used, 160_500);
		assert.equal(cached.context?.limit, 200_000);
	});

	it("extraction blobs carry no context (–, the doctrine)", () => {
		const blob = toBlobs({
			jobs: [],
			extractions: [{ id: "cx", chatId: "cx", kind: "chat", title: "T", phase: "extracting", startedAt: NOW }],
		})[0]!;
		assert.equal(blob.context, null);
	});

	it("names each job by what it is", () => {
		assert.equal(blobLabel({ process: "extraction" }), "Building facts");
		assert.equal(blobLabel({ process: "job", jobKind: "research" }), "Research agent");
		assert.equal(blobLabel({ process: "job", jobKind: "pdf" }), "PDF reader");
		assert.equal(blobLabel({ process: "job" }), "Sub-agent");
	});

	it("says how long ago a change was", () => {
		const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
		assert.equal(agoLabel(at(20_000), NOW), "now");
		assert.equal(agoLabel(at(2 * 60_000), NOW), "2 min");
		assert.equal(agoLabel(at(60 * 60_000), NOW), "1 hour");
		assert.equal(agoLabel(at(5 * 60 * 60_000), NOW), "5 hours");
		assert.equal(agoLabel(at(30 * 60 * 60_000), NOW), "yesterday");
		assert.equal(agoLabel(at(3 * 24 * 60 * 60_000), NOW), "3 days");
		assert.match(agoLabel(at(20 * 24 * 60 * 60_000), NOW), /^Aug 2[01]$/);
		assert.equal(agoLabel("not a date", NOW), "");
	});

	it("formatElapsed ticks compactly", () => {
		assert.equal(formatElapsed(45_000), "45s");
		assert.equal(formatElapsed(184_000), "3m 04s");
		assert.equal(formatElapsed(4_320_000), "1h 12m");
	});

	it("pagesLabel reads a token count as pages", () => {
		assert.equal(pagesLabel(40_000), "about 80 pages");
		assert.equal(pagesLabel(400), "about 1 page");
	});

	it("formatTokens trims (never 38.0k)", () => {
		assert.equal(formatTokens(38_000), "38k");
		assert.equal(formatTokens(1_234_567), "1.2M");
		assert.equal(formatTokens(950), "950");
	});
});

describe("background jobs render", () => {
	it("renders nothing while idle", () => {
		assert.equal(renderToStaticMarkup(<BackgroundJobs feed={{ jobs: [], extractions: [] }} waiting={null} />), "");
	});

	it("one row per running job: name, what it is with elapsed, and Stop", () => {
		const html = renderToStaticMarkup(
			<BackgroundJobs
				feed={{
					jobs: [job({ id: "j1", kind: "demo", activity: "building sandbox…", title: "Chain-rule demo" })],
					extractions: [{ id: "cx", chatId: "cx", kind: "chat", title: "Old lesson", phase: "merging", startedAt: NOW - 60_000 }],
				}}
				waiting={null}
			/>,
		);
		assert.match(html, /data-testid="activity-section"/);
		assert.match(html, /data-testid="activity-blob-job"/);
		assert.match(html, /data-testid="activity-blob-extraction"/);
		assert.match(html, /Running in the background/);
		assert.match(html, /Demo builder, <span data-testid="activity-blob-elapsed">/);
		assert.match(html, /Building facts, <span data-testid="activity-blob-elapsed">/);
		assert.match(html, /data-testid="activity-abort"[^>]*>Stop</, "Stop on every row");
		assert.match(html, /aria-label="Stop Demo builder in Chain-rule demo"/);
		assert.doesNotMatch(html, /building sandbox…/, "the activity line is in the detail");
		// Total cost: nothing priced → "–" beside the heading.
		assert.match(html, /activity-total-cost[^>]*>–</);
		// A cut-off name keeps its native title.
		assert.match(html, /title="Chain-rule demo"/);
	});


	it("shows the plan that pays for the running jobs", () => {
		const usage = {
			model: "agent:outside-agent",
			inputTokens: 10_000,
			outputTokens: 1000,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			reasoningTokens: 0,
			steps: 1,
		};
		const html = renderToStaticMarkup(
			<BackgroundJobs
				feed={{
					jobs: [
						job({ id: "a", usage }),
						job({ id: "b", usage, createdAt: new Date(NOW - 20_000).toISOString() }),
					],
					extractions: [],
				}}
				waiting={null}
			/>,
		);
		assert.match(html, /activity-total-cost[^>]*>Your agent</);
	});
});