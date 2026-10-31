/**
 * /api/agent-folder — the godspeed folder the agent is opened in.
 *   GET: where it is, whether it's set up, and the commands to copy.
 *   POST { action: "setup", folder? }: make or update it (in another
 *   folder when given; the app remembers it).
 *   POST { action: "dismiss-notice" }: hide the one-time notice for
 *   people who set up the old way.
 *   POST { action: "remove-old-setup" }: remove the old plugin and the old
 *   Codex block (the view's oldSetup).
 */
import { AgentFolderError, agentFolderView, dismissFolderNotice, removeOldSetup, setUpAgentFolder } from "@/server";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
	return Response.json(agentFolderView(), { headers: NO_STORE });
}

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { action?: unknown; folder?: unknown };
	if (body.action === "dismiss-notice") {
		dismissFolderNotice();
		return Response.json({ ok: true }, { headers: NO_STORE });
	}
	if (body.action === "remove-old-setup") {
		try {
			removeOldSetup();
		} catch (err) {
			return Response.json({ error: `Couldn't remove it: ${(err as Error).message}` }, { status: 500 });
		}
		return Response.json(agentFolderView(), { headers: NO_STORE });
	}
	if (body.action !== "setup") return Response.json({ error: 'action must be "setup", "dismiss-notice" or "remove-old-setup"' }, { status: 400 });
	if (body.folder !== undefined && typeof body.folder !== "string") return Response.json({ error: "folder must be a string" }, { status: 400 });
	try {
		return Response.json(setUpAgentFolder(body.folder), { headers: NO_STORE });
	} catch (err) {
		if (err instanceof AgentFolderError) return Response.json({ error: err.message }, { status: 400 });
		throw err;
	}
}
