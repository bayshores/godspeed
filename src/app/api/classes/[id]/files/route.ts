/**
 * POST /api/classes/[id]/files — add files to a class (classes wave,
 * 2026-10-26). Multipart: field "files" (one or more) and "kind"
 * ("study" = turned into the class's graph facts, "info" = course info the
 * teacher can read but that never becomes facts).
 */
import { addCopiedFile } from "@/server";
import { isClassId } from "@/core";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!isClassId(id)) return Response.json({ error: "No such class" }, { status: 404 });
	const form = await req.formData();
	const kind = form.get("kind") === "info" ? "info" : form.get("kind") === "study" ? "study" : null;
	if (!kind) return Response.json({ error: 'kind must be "study" or "info"' }, { status: 400 });
	const files = form.getAll("files").filter((f): f is File => f instanceof File);
	if (files.length === 0) return Response.json({ error: "no files" }, { status: 400 });
	const results = [];
	for (const file of files) {
		const outcome = addCopiedFile(id, file.name, new Uint8Array(await file.arrayBuffer()), kind);
		results.push(outcome.ok ? { name: file.name, ok: true, file: outcome.value } : { name: file.name, ok: false, error: outcome.error });
		if (!outcome.ok && outcome.code === "not_found") return Response.json({ error: outcome.error }, { status: 404 });
	}
	return Response.json({ results });
}
