/**
 * PUT /api/chats/[id]/class — move a lesson to another class. Body { classId: "<id>" | "none" }. The lesson's facts
 * leave the old class graph and are rebuilt in the new one; refused while
 * a turn or job runs.
 */
import { moveChatToClass } from "@/server";
import { parseClassScope } from "@/core";

export const dynamic = "force-dynamic";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const body = (await req.json().catch(() => ({}))) as { classId?: unknown };
	const target = parseClassScope(typeof body.classId === "string" ? body.classId : undefined);
	if (target === undefined || body.classId === undefined) return Response.json({ error: 'classId must be a class id or "none"' }, { status: 400 });
	const outcome = await moveChatToClass(id, target);
	if (!outcome.ok) return Response.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
	return Response.json({ ok: true, ...outcome.value });
}
