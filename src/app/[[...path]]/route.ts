/** Every path outside /api and /pdfjs: the built UI (src/backend/server/ui-files.ts). */
import { uiFile } from "@/backend/server/ui-files";

type Ctx = { params: Promise<{ path?: string[] }> };

export async function GET(_req: Request, { params }: Ctx) {
	const file = uiFile((await params).path ?? []);
	// A 404 is never cached: the file or route may exist after the next update.
	if (!file) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
	return new Response(new Uint8Array(file.body), { headers: { "Content-Type": file.type, "Cache-Control": file.cache } });
}
