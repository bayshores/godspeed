/**
 * /api/agent-notes — Settings → Connection's "Remembered" list: GET the
 * notes outside agents saved with remember, DELETE ?id= removes one.
 */
import { agentNotesView, removeAgentNote } from "@/server";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
	return Response.json({ notes: agentNotesView() }, { headers: NO_STORE });
}

export async function DELETE(req: Request) {
	const id = new URL(req.url).searchParams.get("id");
	if (!id || !removeAgentNote(id)) return Response.json({ error: "No such note." }, { status: 404, headers: NO_STORE });
	return Response.json({ notes: agentNotesView() }, { headers: NO_STORE });
}
