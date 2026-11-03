/**
 * Prompt-segment discovery + override resolution. The agent layer owns it
 * because composition lives here: composeInstructions (teacher-agent.ts)
 * composes through effectivePromptSegments, reading this layer's own tree
 * (src/agent/prompts).
 *
 * The agent layer never imports the store adapters, so the override-file
 * READ lives here too; the override-file writes stay in
 * src/store/prompt-overrides.ts. Both share the pure path grammar
 * (src/core/prompt-segments.ts).
 *
 * SEGMENTS: the shared base (src/agent/system-prompt.md), then every
 * numeric-prefix *.md fragment in the agent's own directory (sorted by
 * filename), then the shared/ fragments as a trailing appendix. Practice
 * skips the base and takes only PRACTICE_SHARED_FRAGMENTS. Study takes the
 * teacher's whole prompt plus STUDY_PRACTICE_FRAGMENTS and its own
 * fragment. An override keyed to a segment the source no longer ships
 * stops composing automatically.
 *
 * OVERRIDES: override files mirror the source layout under
 * config.PROMPTS_OVERRIDE_DIR — "system-prompt.md" at the root,
 * "shared/<file>", "teacher/<file>" / "prober/<file>" / "practice/<file>" /
 * "study/<file>". A saved file is the learner's version and is used in
 * place of the source.
 */

import fs from "node:fs";
import path from "node:path";
import { PATHS, promptOverrideFile } from "../config.ts";
import { FRAGMENT_RE, isValidSegmentPath, type PromptAgent, type PromptSegmentInfo } from "../core/prompt-segments.ts";

const PROMPTS_DIR = path.join(PATHS.root, "src", "agent", "prompts");

/** Shared fragments the PRACTICE agent composes: voice, accuracy and the
 *  mental model are one law across every agent, and formatting too
 *  (practice writes the same $...$ / $$...$$ LaTeX and markdown). The
 *  question/confidence/file mechanics stay out (practice has no such
 *  tools). */
const PRACTICE_SHARED_FRAGMENTS = ["10-voice.md", "12-class-context.md", "15-accuracy.md", "16-mental-model.md", "40-formatting.md"];
/** Talk is a small side panel: the voice only (its own base sets short replies). */
const TALK_SHARED_FRAGMENTS = ["10-voice.md"];

/** Read one override file, or null when absent/invalid — the composition
 *  side's reader (the store's readOverride is the same mirror layout,
 *  kept separate because the layers may not import each other). */
function readPromptOverride(segmentPath: string): string | null {
	if (!isValidSegmentPath(segmentPath)) return null;
	try {
		return fs.readFileSync(promptOverrideFile(segmentPath), "utf-8");
	} catch {
		return null;
	}
}

/** The practice fragments a STUDY session composes: the hint and
 *  claimed-answer rules its problems run on. */
const STUDY_PRACTICE_FRAGMENTS = ["20-hints.md"];

type Segment = { path: string; shared: boolean; file: string };

/** One agent directory's fragments, sorted (optionally only some). */
function directoryFragments(dir: PromptAgent, only?: readonly string[]): Segment[] {
	const full = path.join(PROMPTS_DIR, dir);
	if (!fs.existsSync(full)) return [];
	return fs
		.readdirSync(full)
		.filter((f) => FRAGMENT_RE.test(f) && (only === undefined || only.includes(f)))
		.sort()
		.map((f) => ({ path: `${dir}/${f}`, shared: false, file: path.join(full, f) }));
}

/** List the SOURCE segments for one agent, in composition order: the
 *  agent's job and method lead, the shared mechanics are an appendix. */
function listSourceSegments(agent: PromptAgent): Segment[] {
	// Practice and Talk skip the teaching base (their 00-base.md plays that
	// role) and take only a curated shared appendix.
	const segments: Segment[] = agent === "practice" || agent === "talk" ? [] : [
		{ path: "system-prompt.md", shared: true, file: PATHS.teacherPrompt },
	];
	// Study is the teacher plus practice's hint rules plus its own fragment.
	if (agent === "study") {
		segments.push(...directoryFragments("teacher"), ...directoryFragments("practice", STUDY_PRACTICE_FRAGMENTS), ...directoryFragments("study"));
	} else {
		segments.push(...directoryFragments(agent));
	}
	const sharedDir = path.join(PROMPTS_DIR, "shared");
	if (fs.existsSync(sharedDir)) {
		const allow = agent === "practice" ? PRACTICE_SHARED_FRAGMENTS : agent === "talk" ? TALK_SHARED_FRAGMENTS : null;
		const sharedFragments = fs
			.readdirSync(sharedDir)
			.filter((f) => FRAGMENT_RE.test(f) && (allow === null || allow.includes(f)))
			.sort();
		for (const f of sharedFragments) {
			segments.push({ path: `shared/${f}`, shared: true, file: path.join(sharedDir, f) });
		}
	}
	return segments;
}

/** Every segment of one agent's prompt with its source text and the
 *  learner's saved version (null when none). */
export function effectivePromptSegments(agent: PromptAgent): PromptSegmentInfo[] {
	return listSourceSegments(agent).map((segment) => {
		let sourceText: string;
		try {
			sourceText = fs.readFileSync(segment.file, "utf-8");
		} catch {
			sourceText = ""; // source unreadable — the agent loader would crash anyway
		}
		return {
			path: segment.path,
			sourceText,
			overrideText: readPromptOverride(segment.path),
			shared: segment.shared,
		};
	});
}

/** Every known segment path across the lesson agents (route validation). */
export function allSegmentPaths(): string[] {
	const paths = new Set<string>();
	for (const agent of ["prober", "teacher", "practice", "study"] as const) {
		for (const segment of listSourceSegments(agent)) paths.add(segment.path);
	}
	return [...paths].sort();
}
