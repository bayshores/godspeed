/**
 * /api/classes/[id]/exams (redesign plan, owner-approved 2026-10-27).
 *  GET  — the class's exams, soonest first
 *  POST — add one { name, date: "YYYY-MM-DD", fileIds?: string[] }
 */
import { addClassExam, listClassExams } from "@/src/server";
import { isClassId } from "@/src/core";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
	const { id } = await params;
	if (!isClassId(id)) return Response.json({ error: "No such class" }, { status: 404 });
	const outcome = listClassExams(id);
	if (!outcome.ok) return Response.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
	return Response.json({ exams: outcome.value });
}

export async function POST(req: Request, { params }: Ctx) {
	const { id } = await params;
	if (!isClassId(id)) return Response.json({ error: "No such class" }, { status: 404 });
	const body = (await req.json().catch(() => ({}))) as { name?: unknown; date?: unknown; fileIds?: unknown };
	const outcome = addClassExam(id, {
		name: body.name as string,
		date: body.date as string,
		...(body.fileIds !== undefined ? { fileIds: body.fileIds as string[] } : {}),
	});
	if (!outcome.ok) return Response.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
	return Response.json({ exam: outcome.value }, { status: 201 });
}
