/**
 * /api/classes (classes wave, owner-approved 2026-10-26).
 *  GET  — every class (archived included; the switcher filters)
 *  POST — create a class { name, description? }
 */
import { createClass, listClasses, startClassScanner } from "@/server";

export const dynamic = "force-dynamic";

export async function GET() {
	startClassScanner();
	return Response.json({ classes: listClasses() });
}

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { name?: unknown; description?: unknown };
	if (typeof body.name !== "string" || body.name.trim() === "") {
		return Response.json({ error: "A class needs a name" }, { status: 400 });
	}
	const description = typeof body.description === "string" ? body.description : undefined;
	return Response.json({ class: createClass({ name: body.name, description }) }, { status: 201 });
}
