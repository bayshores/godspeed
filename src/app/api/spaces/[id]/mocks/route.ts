/**
 * POST /api/spaces/[id]/mocks — make the prep's next mock and ask the
 * teacher for its questions. → { mockId }. A 409 while another mock is
 * unfinished.
 */
import { createMock } from "@/backend/server";
import { isSpaceId } from "@/shared/core";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!isSpaceId(id)) return Response.json({ error: "No such prep" }, { status: 404 });
	const made = createMock(id);
	return made.ok ? Response.json(made.value, { status: 201 }) : Response.json({ error: made.error }, { status: made.status });
}
