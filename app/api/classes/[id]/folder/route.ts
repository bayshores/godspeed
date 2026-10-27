/**
 * /api/classes/[id]/folder (classes wave, 2026-10-26).
 *  PUT    — { path } link (or re-link) a folder on this computer; its
 *           supported files are added as study material
 *  DELETE — unlink: the folder's files leave the class with their facts
 *           (the folder itself is never touched)
 */
import { linkFolder, unlinkFolder } from "@/src/server";
import { isClassId } from "@/src/core";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Ctx) {
	const { id } = await params;
	if (!isClassId(id)) return Response.json({ error: "No such class" }, { status: 404 });
	const body = (await req.json().catch(() => ({}))) as { path?: unknown };
	if (typeof body.path !== "string" || body.path.trim() === "") return Response.json({ error: "path is required" }, { status: 400 });
	const outcome = linkFolder(id, body.path.trim());
	if (!outcome.ok) return Response.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
	return Response.json({ class: outcome.value });
}

export async function DELETE(_req: Request, { params }: Ctx) {
	const { id } = await params;
	if (!isClassId(id)) return Response.json({ error: "No such class" }, { status: 404 });
	const outcome = unlinkFolder(id);
	if (!outcome.ok) return Response.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
	return Response.json({ class: outcome.value });
}
