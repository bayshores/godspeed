/**
 * GET /api/deadlines — every deadline not yet done, from
 * every class that is not archived, soonest due first, each with its class
 * id and name. Home reads it. Read-only.
 */
import { listOpenDeadlines } from "@/backend/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json({ deadlines: listOpenDeadlines() });
}
