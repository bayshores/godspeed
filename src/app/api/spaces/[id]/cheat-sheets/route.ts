/**
 * /api/spaces/[id]/cheat-sheets
 *  GET — the space's Cheat sheets page: each deadline and where its sheet is (SpaceSheetsView)
 */
import { spaceSheetsView } from "@/backend/server";
import { isSpaceId } from "@/shared/core";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
	const { id } = await params;
	const view = isSpaceId(id) ? spaceSheetsView(id) : null;
	if (!view) return Response.json({ error: "No such space" }, { status: 404 });
	return view.ok ? Response.json(view.value) : Response.json({ error: view.error }, { status: view.status });
}
