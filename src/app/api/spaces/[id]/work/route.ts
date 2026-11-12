/**
 * /api/spaces/[id]/work
 *  DELETE — close the summary of the teacher's last round of work on the
 *           space (nothing happens while a round is still going)
 */
import { closeSpaceWork } from "@/backend/server";
import { isSpaceId } from "@/shared/core";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!isSpaceId(id)) return Response.json({ error: "No such space" }, { status: 404 });
	closeSpaceWork(id);
	return Response.json({ ok: true });
}
