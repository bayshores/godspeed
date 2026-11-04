/**
 * /api/classes/[id]/cheat-sheets
 *  GET — the class's Cheat sheets page: each deadline and where its sheet is (ClassSheetsView)
 */
import { classSheetsView } from "@/server";
import { isClassId } from "@/core";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
	const { id } = await params;
	const view = isClassId(id) ? classSheetsView(id) : null;
	if (!view) return Response.json({ error: "No such class" }, { status: 404 });
	return view.ok ? Response.json(view.value) : Response.json({ error: view.error }, { status: view.status });
}
