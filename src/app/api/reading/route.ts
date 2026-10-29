/**
 * GET /api/reading?path=… — the file the teacher is reading, for the
 * lesson's "agent at work" view: { kind: "text", text } or
 * { kind: "pdf", pageCount, aspect }.
 * GET /api/reading?path=…&page=N — one PDF page as a PNG.
 */
import { readingDocument, readingPdfPage } from "@/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	const url = new URL(req.url);
	const path = url.searchParams.get("path");
	if (!path) return Response.json({ error: "path is required" }, { status: 400 });
	const pageParam = url.searchParams.get("page");
	if (pageParam === null) {
		const outcome = await readingDocument(path);
		if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });
		return Response.json(outcome.value, { headers: { "Cache-Control": "no-store" } });
	}
	const page = Number(pageParam);
	if (!Number.isInteger(page) || page < 1) return Response.json({ error: "page must be a whole number from 1" }, { status: 400 });
	const outcome = await readingPdfPage(path, page);
	if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });
	return new Response(new Uint8Array(outcome.value), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=300" } });
}
