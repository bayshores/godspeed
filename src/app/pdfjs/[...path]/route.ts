/**
 * /pdfjs/<file> — pdf.js's worker and the data it loads (standard fonts,
 * character maps, image decoders) for showing cheat sheet PDFs, from the
 * app, never the network. Outside /api: a worker's requests don't carry
 * the desktop API secret, which only the window's main frame gets.
 */
import { pdfjsAsset } from "@/backend/server";

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(_req: Request, { params }: Ctx) {
	const asset = pdfjsAsset((await params).path);
	if (!asset) return new Response("Not found", { status: 404 });
	return new Response(new Uint8Array(asset.body), { headers: { "Content-Type": asset.type, "Cache-Control": "public, max-age=86400" } });
}
