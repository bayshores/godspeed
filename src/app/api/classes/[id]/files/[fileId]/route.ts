/**
 * /api/classes/[id]/files/[fileId] (classes wave, 2026-10-26).
 *  PUT    — { kind: "study" | "info" } switch, or { retry: true }
 *  DELETE — remove a copied file and its facts
 */
import { removeFile, retryFile, setFileKind } from "@/server";
import { isClassId } from "@/core";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; fileId: string }> };

export async function PUT(req: Request, { params }: Ctx) {
	const { id, fileId } = await params;
	if (!isClassId(id)) return Response.json({ error: "No such class" }, { status: 404 });
	const body = (await req.json().catch(() => ({}))) as { kind?: unknown; retry?: unknown };
	if (body.retry === true) {
		const outcome = retryFile(id, fileId);
		if (!outcome.ok) return Response.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
		return Response.json({ ok: true });
	}
	if (body.kind !== "study" && body.kind !== "info") return Response.json({ error: 'kind must be "study" or "info"' }, { status: 400 });
	const outcome = setFileKind(id, fileId, body.kind);
	if (!outcome.ok) return Response.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
	return Response.json({ file: outcome.value });
}

export async function DELETE(_req: Request, { params }: Ctx) {
	const { id, fileId } = await params;
	if (!isClassId(id)) return Response.json({ error: "No such class" }, { status: 404 });
	const outcome = removeFile(id, fileId);
	if (!outcome.ok) return Response.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
	return Response.json({ ok: true });
}
