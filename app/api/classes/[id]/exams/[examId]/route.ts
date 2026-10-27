/**
 * /api/classes/[id]/exams/[examId] (redesign plan, owner-approved 2026-10-27).
 *  PUT    — patch { name?, date?: "YYYY-MM-DD", fileIds? }
 *  DELETE — remove the exam
 */
import { removeClassExam, updateClassExam } from "@/src/server";
import { isClassId } from "@/src/core";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; examId: string }> };

export async function PUT(req: Request, { params }: Ctx) {
	const { id, examId } = await params;
	if (!isClassId(id)) return Response.json({ error: "No such class" }, { status: 404 });
	const body = (await req.json().catch(() => ({}))) as { name?: unknown; date?: unknown; fileIds?: unknown };
	const outcome = updateClassExam(id, examId, {
		...(body.name !== undefined ? { name: body.name as string } : {}),
		...(body.date !== undefined ? { date: body.date as string } : {}),
		...(body.fileIds !== undefined ? { fileIds: body.fileIds as string[] } : {}),
	});
	if (!outcome.ok) return Response.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
	return Response.json({ exam: outcome.value });
}

export async function DELETE(_req: Request, { params }: Ctx) {
	const { id, examId } = await params;
	if (!isClassId(id)) return Response.json({ error: "No such class" }, { status: 404 });
	const outcome = removeClassExam(id, examId);
	if (!outcome.ok) return Response.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
	return Response.json({ ok: true });
}
