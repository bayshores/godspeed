/**
 * /api/spaces
 *  GET  — every space (archived included; the switcher filters)
 *  POST — create a space { name, description? }
 */
import { createSpace, listSpaces, startSpaceScanner } from "@/backend/server";

export const dynamic = "force-dynamic";

export async function GET() {
	startSpaceScanner();
	return Response.json({ spaces: listSpaces() });
}

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { name?: unknown; description?: unknown };
	if (typeof body.name !== "string" || body.name.trim() === "") {
		return Response.json({ error: "A space needs a name" }, { status: 400 });
	}
	const description = typeof body.description === "string" ? body.description : undefined;
	return Response.json({ space: createSpace({ name: body.name, description }) }, { status: 201 });
}
