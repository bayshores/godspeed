/**
 * /api/spaces/[id]/deadlines/[deadlineId]/cheat-sheet/pdf/[n]
 *  GET — version n of the cheat sheet, the PDF exactly as the agent made it
 */
import { cheatSheetPdf } from "@/backend/server";
import { isSpaceId } from "@/shared/core";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; deadlineId: string; n: string }> };

export async function GET(_req: Request, { params }: Ctx) {
	const { id, deadlineId, n } = await params;
	const pdf = /^[1-9]\d{0,8}$/.test(n) && isSpaceId(id) ? cheatSheetPdf(id, deadlineId, Number(n)) : null;
	if (!pdf) return Response.json({ error: "No such cheat sheet" }, { status: 404 });
	// A version never changes once made.
	return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Cache-Control": "private, max-age=31536000, immutable" } });
}
