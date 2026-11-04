/**
 * /katex/<file> — KaTeX's stylesheet and fonts for the cheat sheet's
 * pages. Outside /api: a page's sandboxed frame asks for them, and only
 * the window itself carries the desktop API secret.
 */
import { katexAsset } from "@/server";

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(_req: Request, { params }: Ctx) {
	const asset = katexAsset((await params).path);
	if (!asset) return new Response("Not found", { status: 404 });
	return new Response(new Uint8Array(asset.body), { headers: { "Content-Type": asset.type, "Cache-Control": "public, max-age=86400" } });
}
