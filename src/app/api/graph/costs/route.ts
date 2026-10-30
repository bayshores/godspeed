/**
 * GET /api/graph/costs — the graph view's cost pill: what the graph
 * PIPELINE used, folded at read time from the chat extraction runs and the
 * notes-source runs. Thin transport over src/server's graphCosts(); the
 * fold itself is pure core (core/cost-summary.ts).
 *
 * Scope: the graph pipeline ONLY — teaching turns and sub-agent jobs have
 * their own usage channels elsewhere.
 */
import { graphCosts, requestClassScope } from "@/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	const scope = requestClassScope(req);
	if (scope === undefined) return Response.json({ error: "No such class" }, { status: 404 });
	return Response.json(graphCosts(scope));
}
