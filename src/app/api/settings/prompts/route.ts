/**
 * GET /api/settings/prompts — every prompt part the teacher and the level
 * check compose, derived from SOURCE at runtime (src/agent/prompts), each
 * with its source text and the learner's saved version (null when none).
 * A part both agents share is listed once.
 *
 *   GET → 200 {segments: PromptSegmentInfo[]}
 *
 * The text is written through PUT/DELETE /api/settings/prompts/[...segment].
 */

import type { PromptSegmentInfo } from "@/core";
import { effectivePromptSegments } from "@/server";

export const dynamic = "force-dynamic";

export async function GET() {
	const byPath = new Map<string, PromptSegmentInfo>();
	for (const s of [...effectivePromptSegments("teacher"), ...effectivePromptSegments("prober")]) byPath.set(s.path, s);
	return Response.json({ segments: [...byPath.values()] });
}
