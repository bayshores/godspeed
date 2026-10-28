/**
 * GET /api/deadlines — every deadline not yet done, from
 * every class that is not archived, soonest due first, each with its class
 * id and name. Home and the sidebar's Due soon read it. Read-only.
 */
import { listOpenDeadlines } from "@/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json({ deadlines: listOpenDeadlines() });
}
