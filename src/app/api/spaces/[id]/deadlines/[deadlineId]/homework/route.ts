/**
 * GET /api/spaces/[id]/deadlines/[deadlineId]/homework — what a homework
 * lesson shows of its deadline: its name, problems and assignment file.
 * 404 once the space or deadline is gone.
 */
import { homeworkView } from "@/backend/server";
import { isSpaceId } from "@/shared/core";

type Ctx = { params: Promise<{ id: string; deadlineId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
	const { id, deadlineId } = await params;
	const homework = isSpaceId(id) ? homeworkView(id, deadlineId) : null;
	if (!homework) return Response.json({ error: "No such deadline" }, { status: 404 });
	return Response.json({ homework });
}
