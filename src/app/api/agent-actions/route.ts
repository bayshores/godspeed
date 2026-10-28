/**
 * GET /api/agent-actions — what outside agents changed lately (Halley's
 * panel, "Recent"): the last 20, newest first, kept in memory only.
 */
import { recentAgentActions } from "@/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json({ actions: recentAgentActions() }, { headers: { "Cache-Control": "no-store" } });
}
