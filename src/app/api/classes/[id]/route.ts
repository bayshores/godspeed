/**
 * /api/classes/[id] (classes wave, owner-approved 2026-10-26).
 *  GET    — the full record; ?scan=1 rescans its linked folder first
 *           (the switcher asks when you switch to the class)
 *  PUT    — { name?, description?, archived?, signature? } (signature null clears it)
 *  DELETE — the class with its lessons, copied files and graph (a linked
 *           folder on your computer is never touched)
 */
import { deleteClass, getClass, scanLinkedFolder, updateClass } from "@/server";
import { cleanSignature, isClassId, SIGNATURE_MAX } from "@/core";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
	const { id } = await params;
	if (!isClassId(id)) return Response.json({ error: "No such class" }, { status: 404 });
	if (new URL(req.url).searchParams.get("scan") === "1") scanLinkedFolder(id);
	const record = getClass(id);
	if (!record) return Response.json({ error: "No such class" }, { status: 404 });
	return Response.json({ class: record });
}

export async function PUT(req: Request, { params }: Ctx) {
	const { id } = await params;
	if (!isClassId(id)) return Response.json({ error: "No such class" }, { status: 404 });
	const body = (await req.json().catch(() => ({}))) as { name?: unknown; description?: unknown; archived?: unknown; signature?: unknown };
	if (body.name !== undefined && (typeof body.name !== "string" || body.name.trim() === "")) {
		return Response.json({ error: "A class needs a name" }, { status: 400 });
	}
	const signature = body.signature === null ? null : typeof body.signature === "object" ? cleanSignature(body.signature) : undefined;
	if (signature === null && body.signature !== null) {
		return Response.json({ error: `A signature is one line of at most ${SIGNATURE_MAX} characters` }, { status: 400 });
	}
	const outcome = updateClass(id, {
		...(typeof body.name === "string" ? { name: body.name } : {}),
		...(typeof body.description === "string" ? { description: body.description } : {}),
		...(typeof body.archived === "boolean" ? { archived: body.archived } : {}),
		...(signature !== undefined ? { signature } : {}),
	});
	if (!outcome.ok) return Response.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
	return Response.json({ class: outcome.value });
}

export async function DELETE(_req: Request, { params }: Ctx) {
	const { id } = await params;
	if (!isClassId(id)) return Response.json({ error: "No such class" }, { status: 404 });
	const outcome = await deleteClass(id);
	if (!outcome.ok) return Response.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
	return Response.json({ ok: true, ...outcome.value });
}
