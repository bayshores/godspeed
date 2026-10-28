/**
 * GET /api/progress?class=<id|none>[&today=YYYY-MM-DD] (redesign plan,
 * owner-approved 2026-10-27) — everything the class Overview and the topic
 * Graph page show, in one payload (core/progress.ts ProgressPayload):
 * topics with scores, arrows and columns, facts, file coverage and "Next
 * up", how each lesson went, calibration, and per-deadline "Work on next".
 * `today` (the browser's calendar day) sets the deadlines' days-left; absent =
 * this computer's day. Read-only.
 */
import { progressFor, requestClassScope } from "@/server";
import { isCalendarDate } from "@/core";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	const scope = requestClassScope(req);
	if (scope === undefined) return Response.json({ error: "No such class" }, { status: 404 });
	const today = new URL(req.url).searchParams.get("today");
	if (today !== null && !isCalendarDate(today)) return Response.json({ error: "today must be YYYY-MM-DD" }, { status: 400 });
	const payload = progressFor(scope, today ? { today } : {});
	if (!payload) return Response.json({ error: "No such class" }, { status: 404 });
	return Response.json(payload);
}
