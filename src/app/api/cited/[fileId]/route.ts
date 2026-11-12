/**
 * GET /api/cited/<fileId>?range=…: what a space file source in a teacher
 * message shows, as { name, range, page, text }.
 */
import { citedPassage } from "@/backend/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ fileId: string }> }) {
	const { fileId } = await params;
	const range = new URL(req.url).searchParams.get("range");
	if (!range) return Response.json({ error: "range is required" }, { status: 400 });
	const outcome = citedPassage(fileId, range);
	if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });
	return Response.json(outcome.value, { headers: { "Cache-Control": "no-store" } });
}
