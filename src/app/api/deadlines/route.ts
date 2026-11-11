/**
 * GET /api/deadlines — from every class that is not archived, soonest due
 * first, each with its class id and name: `deadlines` not yet done, and
 * `doneToday` ticked done today. Today reads it. Read-only.
 */
import { listDeadlinesDoneOn, listOpenDeadlines } from "@/backend/server";
import { localDay } from "@/shared/core";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json({ deadlines: listOpenDeadlines(), doneToday: listDeadlinesDoneOn(localDay()) });
}
