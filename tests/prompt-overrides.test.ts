/**
 * Tests for the prompt-override store (src/store/prompt-overrides.ts), the
 * source-derived segment list, composition with saved versions, and the
 * clean-up of the old on/off switches.
 *
 * LH_DATA_DIR must be set before the first import that loads src/config.ts,
 * so every app-module import below is dynamic. data/prompts holds real
 * override files; after() checks this suite never touched it.
 *
 * This file owns the temp dir: every override-writing test lives here.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { createFauxCore } from "@earendil-works/pi-ai";
import type { PiEngine } from "../src/agent/models.ts";
// The agent engine loads on first use in the app; agent-building tests load it up front.
await (await import("../src/agent/engine-load.ts")).loadAgentCore();

// ── the seam, BEFORE any config-loading import ──────────────────────────────
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-prompt-overrides-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { PROMPTS_OVERRIDE_DIR, SETTINGS_FILE } = await import("../src/config.ts");
const teacherAgent = await import("../src/agent/teacher-agent.ts");
const { allSegmentPaths, effectivePromptSegments } = await import("../src/agent/prompt-segments.ts");
const { isValidSegmentPath } = await import("../src/core/prompt-segments.ts");
const { promptOverrides } = await import("../src/store/prompt-overrides.ts");
const { PUT: putPromptText, DELETE: deletePromptText } = await import("../src/app/api/settings/prompts/[...segment]/route.ts");
const { readSettingsRecord } = await import("../src/server/index.ts");

/** The REAL repo prompts dir this suite must never touch (read-only). */
const REPO_PROMPTS = path.resolve(import.meta.dirname, "../data/prompts");

/** Read-only recursive snapshot of a dir (sorted "rel|size" lines) — the
 *  survival pin compares before/after the whole suite. */
function snapshotDir(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	const out: string[] = [];
	const walk = (rel: string) => {
		for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const child = rel ? `${rel}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(child);
			else out.push(`${child}|${fs.statSync(path.join(dir, child)).size}`);
		}
	};
	walk("");
	return out;
}
const REAL_PROMPTS_BEFORE = snapshotDir(REPO_PROMPTS);

after(() => {
	// The suite's own scratch dies; the REAL user dir must be untouched.
	assert.deepEqual(
		snapshotDir(REPO_PROMPTS),
		REAL_PROMPTS_BEFORE,
		"real data/prompts survives npm test byte-for-byte (the old suite wiped it)",
	);
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

/** A scripted pi engine (pi-ai's faux provider) — the agent build needs an
 *  injected engine since BYOK removed the factory pins. */
function fauxEngine(): PiEngine {
	const faux = createFauxCore({});
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}

/** PUT /api/settings/prompts/<segment...> with a fabricated params context. */
function putSegment(segment: string[], text: string): Promise<Response> {
	return putPromptText(
		new Request("http://test/api/settings/prompts", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text }),
		}),
		{ params: Promise.resolve({ segment }) },
	);
}

/** DELETE /api/settings/prompts/<segment...> with a fabricated params context. */
function deleteSegment(segment: string[]): Promise<Response> {
	return deletePromptText(new Request("http://test/api/settings/prompts", { method: "DELETE" }), {
		params: Promise.resolve({ segment }),
	});
}

describe("isValidSegmentPath (the mirror-layout discipline)", () => {
	it("accepts the shared base and numeric fragments, rejects everything else", () => {
		assert.equal(isValidSegmentPath("system-prompt.md"), true);
		assert.equal(isValidSegmentPath("teacher/20-teaching.md"), true);
		assert.equal(isValidSegmentPath("prober/10-probe-doctrine.md"), true);
		// the shared/ fragments dir (sources v1): composed by BOTH agents,
		// overridable like any other segment
		assert.equal(isValidSegmentPath("shared/10-personality.md"), true);
		for (const bad of [
			"", // empty
			"README.md", // no agent dir
			"teacher/README.md", // not numeric-prefixed
			"teacher/20-teaching.txt", // not .md
			"../system-prompt.md", // traversal
			"agent/../teacher/20-teaching.md", // traversal
			"/etc/passwd", // absolute
			"teacher", // bare dir
			"teacher/", // bare dir
			"teacher/sub/10-x.md", // nested (not the mirror layout)
			"prober\\10-x.md", // backslash
		]) {
			assert.equal(isValidSegmentPath(bad), false, bad);
		}
	});
});

describe("the override store", () => {
	it("listOverrides is empty with no dir, then lists written mirrors sorted", () => {
		fs.rmSync(PROMPTS_OVERRIDE_DIR, { recursive: true, force: true });
		assert.deepEqual(promptOverrides.listOverrides(), []);
		promptOverrides.writeOverride("teacher/20-teaching.md", "custom teaching");
		promptOverrides.writeOverride("system-prompt.md", "custom base");
		assert.deepEqual(promptOverrides.listOverrides(), ["system-prompt.md", "teacher/20-teaching.md"]);
		// A saved file is always in use, so leave none behind for the composition tests.
		promptOverrides.deleteOverride("teacher/20-teaching.md");
		promptOverrides.deleteOverride("system-prompt.md");
	});

	it("readOverride round-trips; delete removes idempotently; invalid paths no-op", () => {
		promptOverrides.writeOverride("prober/30-probe-done.md", "custom probe-done");
		assert.equal(promptOverrides.readOverride("prober/30-probe-done.md"), "custom probe-done");
		promptOverrides.deleteOverride("prober/30-probe-done.md");
		assert.equal(promptOverrides.readOverride("prober/30-probe-done.md"), null);
		promptOverrides.deleteOverride("prober/30-probe-done.md"); // again: no throw
		// traversal junk never reaches disk
		promptOverrides.writeOverride("../evil.md", "nope");
		assert.equal(fs.existsSync(path.join(PROMPTS_OVERRIDE_DIR, "..", "evil.md")), false);
	});

	it("a saved file shows as the segment's override", () => {
		promptOverrides.writeOverride("system-prompt.md", "custom base");
		const base = effectivePromptSegments("teacher").find((s) => s.path === "system-prompt.md");
		assert.ok(base);
		assert.equal(base.overrideText, "custom base");
		promptOverrides.deleteOverride("system-prompt.md");
		const after = effectivePromptSegments("teacher").find((s) => s.path === "system-prompt.md");
		assert.equal(after?.overrideText, null);
	});
});

describe("the source-derived segment list", () => {
	it("mirrors composeInstructions' discovery: base first, numeric fragments sorted, per agent", () => {
		const prober = effectivePromptSegments("prober");
		const teacher = effectivePromptSegments("teacher");
		// The shared base composes both prompts, SAME path.
		assert.equal(prober[0]?.path, "system-prompt.md");
		assert.equal(teacher[0]?.path, "system-prompt.md");
		assert.equal(prober[0].shared, true);
		assert.equal(teacher[0].shared, true);
		assert.equal(prober[0].sourceText.length > 0, true, "base prompt text loads");
		// Fragments track the REAL source tree (numeric order, right agent dir),
		// the agent's OWN fragments between the base and the shared/ appendix —
		// the exact order composeInstructions loads them in (job and method
		// lead, mechanics trail).
		assert.deepEqual(
			prober.map((s) => s.path),
			[
				"system-prompt.md",
				"prober/10-probe-doctrine.md",
				"shared/10-voice.md",
				"shared/12-class-context.md",
				"shared/15-accuracy.md",
				"shared/16-mental-model.md",
				"shared/20-question-tools.md",
				"shared/25-confidence.md",
				"shared/30-learner-files.md",
				"shared/35-work-plan.md",
				"shared/40-formatting.md",
			],
		);
		assert.equal(teacher.some((s) => s.path === "teacher/05-method.md"), true);
		assert.equal(teacher.some((s) => s.path === "teacher/10-planning.md"), true);
		assert.equal(teacher.some((s) => s.path === "teacher/60-probing-in-brief.md"), false);
		assert.equal(
			teacher.every(
				(s) => s.path === "system-prompt.md" || s.path.startsWith("teacher/") || s.path.startsWith("shared/"),
			),
			true,
		);
		// the shared fragments compose for BOTH agents, same path key.
		assert.equal(teacher.some((s) => s.path === "shared/30-learner-files.md" && s.shared), true);
		assert.equal(prober.some((s) => s.path === "shared/30-learner-files.md" && s.shared), true);
		// Voice + accuracy live in shared/ fragments: one law across every agent — including practice, whose
		// near-copy had drifted stale ("You have no research tool here").
		assert.equal(prober.some((s) => s.path === "shared/10-voice.md" && s.shared), true);
		assert.equal(teacher.some((s) => s.path === "shared/10-voice.md" && s.shared), true);
		assert.equal(prober.some((s) => s.path === "shared/15-accuracy.md" && s.shared), true);
		// Tool MECHANICS are shared; question METHODOLOGY is phase-owned.
		assert.equal(prober.some((s) => s.path.startsWith("teacher/")), false);
		assert.equal(teacher.some((s) => s.path.startsWith("prober/")), false);
		// README and other non-numeric files never load.
		assert.equal(allSegmentPaths().some((p) => p.includes("README")), false);
	});

	it("adapts to source changes by construction: the list is computed, not stored", () => {
		// If a fragment vanishes upstream, its override simply stops
		// composing — nothing here can go stale. Pinned by absence:
		const before = allSegmentPaths().length;
		assert.equal(before > 5, true, "base + prober fragments + teacher fragments");
	});
});

// ─── composeInstructions honors overrides (P2 reconciliation) ────
// This file OWNS the (isolated) PROMPTS_OVERRIDE_DIR (parallel-test
// discipline), so every override-writing composition test lives here.

describe("composeInstructions: override honoring + the byte-identical source path", () => {
	const { composeInstructions, createTeacherAgent } = teacherAgent;

	it("with no saved versions, composition is byte-identical to the plain loader", () => {
		// The plain loader, rebuilt inline: base + the agent's own
		// fragments + the shared/ appendix (the  reorder),
		// trimmed, empties dropped, joined with the separator.
		const oldLoader = (kind: "prober" | "teacher") => {
			const fragmentsOf = (dir: string) =>
				fs
					.readdirSync(dir)
					.filter((f) => /^\d+-[\w.-]+\.md$/.test(f))
					.sort()
					.map((f) => fs.readFileSync(path.join(dir, f), "utf-8").trim())
					.filter(Boolean);
			const base = fs.readFileSync("src/agent/system-prompt.md", "utf-8").trim();
			return [
				base,
				...fragmentsOf(`src/agent/prompts/${kind}`),
				...fragmentsOf("src/agent/prompts/shared"),
			].join("\n\n---\n\n");
		};
		assert.equal(composeInstructions("teacher"), oldLoader("teacher"));
		assert.equal(composeInstructions("prober"), oldLoader("prober"));
	});

	it("a saved version swaps in; deleting it brings the source back", () => {
		promptOverrides.writeOverride("teacher/20-teaching.md", "CUSTOM TEACHING LOOP");
		try {
			const on = composeInstructions("teacher");
			assert.ok(on.includes("CUSTOM TEACHING LOOP"), "the saved version composes");
			assert.ok(!on.includes("# Teach — one step at a time"), "source text is replaced");
		} finally {
			promptOverrides.deleteOverride("teacher/20-teaching.md");
		}
		assert.ok(composeInstructions("teacher").includes("# Teach — one step at a time"), "source composes again");
	});

	it("shared/ fragments are overridable — one edit swaps the doctrine in BOTH agents", () => {
		promptOverrides.writeOverride("shared/30-learner-files.md", "MY SHARED FILES DOCTRINE");
		try {
			for (const kind of ["teacher", "prober"] as const) {
				const composed = composeInstructions(kind);
				assert.ok(composed.includes("MY SHARED FILES DOCTRINE"), `${kind} composes the override`);
				assert.ok(!composed.includes("## Learner files"), `${kind} source fragment is replaced`);
			}
		} finally {
			promptOverrides.deleteOverride("shared/30-learner-files.md");
		}
	});

	it("the learner's rules land after the instructions in the system prompt", () => {
		const engine = fauxEngine();
		const rules = "## The learner's rules\n\nVoice\n- No jokes";
		const agent = createTeacherAgent(undefined, { engine, learnerRules: rules });
		assert.equal(agent.state.systemPrompt, `${composeInstructions("teacher")}\n\n---\n\n${rules}`);
		const plain = createTeacherAgent(undefined, { engine });
		assert.equal(plain.state.systemPrompt, composeInstructions("teacher"));
	});
});

describe("the prompts routes", () => {
	const SEGMENT = "teacher/20-teaching.md";

	it("PUT saves a version of a current segment; an unknown segment is a 400", async () => {
		const res = await putSegment(["teacher", "20-teaching.md"], "custom teaching");
		assert.equal(res.status, 200);
		assert.equal(promptOverrides.readOverride(SEGMENT), "custom teaching");
		const bad = await putSegment(["teacher", "99-vanished.md"], "x");
		assert.equal(bad.status, 400);
	});

	it("DELETE removes the saved version and is idempotent", async () => {
		const res = await deleteSegment(["teacher", "20-teaching.md"]);
		assert.equal(res.status, 200);
		assert.deepEqual(await res.json(), { path: SEGMENT, deleted: true });
		assert.equal(promptOverrides.readOverride(SEGMENT), null);
		assert.equal((await deleteSegment(["teacher", "20-teaching.md"])).status, 200);
	});
});

describe("old prompt switches are cleaned up on read", () => {
	it("keeps versions that were switched on, deletes the rest, and drops the switch map", () => {
		promptOverrides.writeOverride("teacher/20-teaching.md", "was on");
		promptOverrides.writeOverride("teacher/10-planning.md", "was off");
		promptOverrides.writeOverride("system-prompt.md", "no switch");
		fs.writeFileSync(
			SETTINGS_FILE,
			JSON.stringify({
				version: 1,
				agent: { tools: { research: false }, prompts: { "teacher/20-teaching.md": true, "teacher/10-planning.md": false } },
			}),
		);
		try {
			const record = readSettingsRecord();
			assert.equal(record?.agent?.tools?.research, false, "the rest of the record survives");
			assert.equal(promptOverrides.readOverride("teacher/20-teaching.md"), "was on");
			assert.equal(promptOverrides.readOverride("teacher/10-planning.md"), null);
			assert.equal(promptOverrides.readOverride("system-prompt.md"), null);
			const onDisk = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")) as { agent: Record<string, unknown> };
			assert.equal("prompts" in onDisk.agent, false, "the switch map is gone from the file");
		} finally {
			promptOverrides.deleteOverride("teacher/20-teaching.md");
			fs.rmSync(SETTINGS_FILE, { force: true });
		}
	});
});

describe("test isolation (the suite must never touch real user data)", () => {
	it("every write this suite makes lands under the LH_DATA_DIR seam, not the repo data dir", () => {
		assert.ok(
			PROMPTS_OVERRIDE_DIR.startsWith(TMP_DATA),
			`PROMPTS_OVERRIDE_DIR (${PROMPTS_OVERRIDE_DIR}) must live under the temp seam (${TMP_DATA})`,
		);
		assert.notEqual(
			PROMPTS_OVERRIDE_DIR,
			REPO_PROMPTS,
			"the seam must NOT resolve to the repo's real data/prompts",
		);
		// The suite proves it writes here:
		promptOverrides.writeOverride("system-prompt.md", "isolation probe");
		assert.equal(
			fs.existsSync(path.join(TMP_DATA, "prompts", "system-prompt.md")),
			true,
			"the write landed under the temp dir",
		);
		promptOverrides.deleteOverride("system-prompt.md");
	});
});
