/**
 * GET /api/cited/<fileId>/page/<n>: one page of a cited space PDF as a PNG.
 */
import { citedPage } from "@/backend/server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ fileId: string; n: string }> }) {
	const { fileId, n } = await params;
	const outcome = await citedPage(fileId, Number(n));
	if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });
	return new Response(new Uint8Array(outcome.value), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=300" } });
}
