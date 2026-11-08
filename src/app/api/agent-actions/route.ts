/**
 * GET /api/agent-actions — the activity log: what outside agents, the app
 * and the learner changed lately, newest first (saved on disk).
 */
import { recentAgentActions } from "@/backend/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json({ actions: recentAgentActions() }, { headers: { "Cache-Control": "no-store" } });
}
