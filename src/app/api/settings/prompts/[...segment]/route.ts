/**
 * PUT/DELETE /api/settings/prompts/[...segment] — the learner's version of
 * one prompt part. A saved version is used in place of the source; deleting
 * it ("Reset to original") brings the source back.
 *
 *   PUT    body {text} → writes data/prompts/<segment path mirror>. 200.
 *          The segment must be a CURRENT source segment (allSegmentPaths
 *          — derived from src/agent/prompts at runtime): overriding a
 *          segment that doesn't compose is a typo or a vanished fragment,
 *          a 400, never a silent orphan.
 *   DELETE → removes the saved version (idempotent).
 */

import { allSegmentPaths, isValidSegmentPath, promptOverrides } from "@/server";

export const dynamic = "force-dynamic";

/** Re-join the catch-all segments into the mirror-layout path; null when
 *  the shape is invalid (traversal, wrong layout — the store re-guards). */
function segmentPathFrom(segments: string[]): string | null {
	const joined = segments.map(decodeURIComponent).join("/");
	return isValidSegmentPath(joined) ? joined : null;
}

export async function PUT(request: Request, ctx: { params: Promise<{ segment: string[] }> }) {
	const { segment } = await ctx.params;
	const path = segmentPathFrom(segment);
	if (!path) return Response.json({ error: "invalid segment path" }, { status: 400 });
	const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
	if (!body || typeof body.text !== "string") {
		return Response.json({ error: "body must be {text: string}" }, { status: 400 });
	}
	if (!new Set(allSegmentPaths()).has(path)) {
		return Response.json(
			{ error: `"${path}" is not a current source segment`, supported: allSegmentPaths() },
			{ status: 400 },
		);
	}
	promptOverrides.writeOverride(path, body.text);
	return Response.json({ path, text: body.text });
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ segment: string[] }> }) {
	const { segment } = await ctx.params;
	const path = segmentPathFrom(segment);
	if (!path) return Response.json({ error: "invalid segment path" }, { status: 400 });
	promptOverrides.deleteOverride(path);
	return Response.json({ path, deleted: true });
}
