/**
 * /api/classes/[id]/deadlines/[deadlineId]/cheat-sheet/files/[file]
 *  GET — a picture or PDF sent in the sheet's chat, as it was kept
 */
import { cheatSheetFile } from "@/backend/server";
import { isClassId } from "@/shared/core";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; deadlineId: string; file: string }> };

export async function GET(_req: Request, { params }: Ctx) {
	const { id, deadlineId, file } = await params;
	const kept = isClassId(id) ? cheatSheetFile(id, deadlineId, file) : null;
	if (!kept) return Response.json({ error: "No such file" }, { status: 404 });
	// A kept file is named by its content, so it never changes.
	return new Response(new Uint8Array(kept.bytes), { headers: { "Content-Type": kept.type, "Cache-Control": "private, max-age=31536000, immutable" } });
}
