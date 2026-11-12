/**
 * PUT /api/chats/[id]/space — move a lesson to another space. Body { spaceId: "<id>" | "none" }. The lesson's facts
 * leave the old space graph and are rebuilt in the new one; refused while
 * a turn or job runs.
 */
import { moveChatToSpace } from "@/backend/server";
import { parseSpaceScope } from "@/shared/core";

export const dynamic = "force-dynamic";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const body = (await req.json().catch(() => ({}))) as { spaceId?: unknown };
	const target = parseSpaceScope(typeof body.spaceId === "string" ? body.spaceId : undefined);
	if (target === undefined || body.spaceId === undefined) return Response.json({ error: 'spaceId must be a space id or "none"' }, { status: 400 });
	const outcome = await moveChatToSpace(id, target);
	if (!outcome.ok) return Response.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
	return Response.json({ ok: true, ...outcome.value });
}
