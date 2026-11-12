/**
 * GET /api/deadlines/[id] — one deadline with its space id (deadline ids
 * are unique across spaces), for the deadline page and the cheat sheet
 * studio. 404 once it is gone.
 */
import { deadlineWithSpace } from "@/backend/server";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
	const owner = deadlineWithSpace((await params).id);
	if (!owner) return Response.json({ error: "No such deadline" }, { status: 404 });
	return Response.json(owner);
}
