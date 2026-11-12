/**
 * GET /api/progress?space=<id|none>[&today=YYYY-MM-DD] — everything the
 * space Overview and the topic Graph page show, in one payload
 * (core/progress.ts ProgressPayload): topics with scores, arrows and columns, facts, file coverage and "Next
 * up", how each lesson went, calibration, and per-deadline "Work on next".
 * `today` (the browser's calendar day) sets the deadlines' days-left; absent =
 * this computer's day. Read-only.
 */
import { progressFor, requestSpaceScope } from "@/backend/server";
import { isCalendarDate } from "@/shared/core";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	const scope = requestSpaceScope(req);
	if (scope === undefined) return Response.json({ error: "No such space" }, { status: 404 });
	const today = new URL(req.url).searchParams.get("today");
	if (today !== null && !isCalendarDate(today)) return Response.json({ error: "today must be YYYY-MM-DD" }, { status: 400 });
	const payload = progressFor(scope, today ? { today } : {});
	if (!payload) return Response.json({ error: "No such space" }, { status: 404 });
	return Response.json(payload);
}
