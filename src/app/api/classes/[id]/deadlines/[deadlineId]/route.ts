/**
 * /api/classes/[id]/deadlines/[deadlineId] (plan 2026-10-28; was /exams).
 *  PUT    — patch { kind?, name?, date?: "YYYY-MM-DD", time?: "HH:MM" | null (null clears), fileIds?, done? }
 *  DELETE — remove the deadline
 */
import { removeClassDeadline, updateClassDeadline } from "@/server";
import { isClassId, type DeadlineKind } from "@/core";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; deadlineId: string }> };

export async function PUT(req: Request, { params }: Ctx) {
	const { id, deadlineId } = await params;
	if (!isClassId(id)) return Response.json({ error: "No such class" }, { status: 404 });
	const body = (await req.json().catch(() => ({}))) as {
		kind?: unknown;
		name?: unknown;
		date?: unknown;
		time?: unknown;
		fileIds?: unknown;
		done?: unknown;
	};
	if (body.done !== undefined && typeof body.done !== "boolean") return Response.json({ error: "done must be true or false" }, { status: 400 });
	const outcome = updateClassDeadline(id, deadlineId, {
		...(body.kind !== undefined ? { kind: body.kind as DeadlineKind } : {}),
		...(body.name !== undefined ? { name: body.name as string } : {}),
		...(body.date !== undefined ? { date: body.date as string } : {}),
		...(body.time !== undefined ? { time: body.time as string | null } : {}),
		...(body.fileIds !== undefined ? { fileIds: body.fileIds as string[] } : {}),
		...(body.done !== undefined ? { done: body.done } : {}),
	});
	if (!outcome.ok) return Response.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
	return Response.json({ deadline: outcome.value });
}

export async function DELETE(_req: Request, { params }: Ctx) {
	const { id, deadlineId } = await params;
	if (!isClassId(id)) return Response.json({ error: "No such class" }, { status: 404 });
	const outcome = removeClassDeadline(id, deadlineId);
	if (!outcome.ok) return Response.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
	return Response.json({ ok: true });
}
