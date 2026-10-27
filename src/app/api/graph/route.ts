import { graphView, requestClassScope } from "@/server";

/**
 * The home graph view's data endpoint (W4; vision §1 "Home page") — thin
 * transport: the server entry (src/server/graph.ts) returns nodes, edges,
 * session provenance, and per-session understanding observations.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	// Classes wave: ?class=<id|none> picks which graph (absent = No class).
	const scope = requestClassScope(req);
	if (scope === undefined) return Response.json({ error: "No such class" }, { status: 404 });
	return Response.json(graphView(scope));
}
