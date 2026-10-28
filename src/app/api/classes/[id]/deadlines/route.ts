/**
 * /api/classes/[id]/deadlines (plan 2026-10-28; was /exams).
 *  GET  — the class's deadlines, soonest due first
 *  POST — add one { kind, name, date: "YYYY-MM-DD", time?: "HH:MM", fileIds?: string[] }
 */
import { addClassDeadline, listClassDeadlines } from "@/server";
import { isClassId, type DeadlineKind } from "@/core";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
	const { id } = await params;
	if (!isClassId(id)) return Response.json({ error: "No such class" }, { status: 404 });
	const outcome = listClassDeadlines(id);
	if (!outcome.ok) return Response.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
	return Response.json({ deadlines: outcome.value });
}

export async function POST(req: Request, { params }: Ctx) {
	const { id } = await params;
	if (!isClassId(id)) return Response.json({ error: "No such class" }, { status: 404 });
	const body = (await req.json().catch(() => ({}))) as { kind?: unknown; name?: unknown; date?: unknown; time?: unknown; fileIds?: unknown };
	const outcome = addClassDeadline(id, {
		kind: body.kind as DeadlineKind,
		name: body.name as string,
		date: body.date as string,
		...(body.time !== undefined && body.time !== null ? { time: body.time as string } : {}),
		...(body.fileIds !== undefined ? { fileIds: body.fileIds as string[] } : {}),
	});
	if (!outcome.ok) return Response.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
	return Response.json({ deadline: outcome.value }, { status: 201 });
}
