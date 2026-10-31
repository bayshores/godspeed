/**
 * /api/rules — teaching rules an agent saved on its own.
 *   GET: the ones still in their lists ({ rules: SavedRule[] }).
 *   POST { action: "remove", where, text }: undo one.
 *   POST { action: "edit", where, text, newText }: rewrite one (it becomes the learner's).
 */
import { parseWhere } from "@/core";
import { agentSavedRules, editRule, removeRule } from "@/server";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
	return Response.json({ rules: agentSavedRules() }, { headers: NO_STORE });
}

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { action?: unknown; where?: unknown; text?: unknown; newText?: unknown };
	const where = parseWhere(body.where);
	if (!where || typeof body.text !== "string") return Response.json({ error: "where and text are required" }, { status: 400 });
	if (body.action === "remove") {
		return removeRule(where, body.text) ? Response.json({ ok: true }, { headers: NO_STORE }) : Response.json({ error: "That rule was already removed." }, { status: 404 });
	}
	if (body.action === "edit" && typeof body.newText === "string") {
		const edited = editRule(where, body.text, body.newText);
		return edited.ok ? Response.json(edited, { headers: NO_STORE }) : Response.json({ error: edited.error }, { status: 400 });
	}
	return Response.json({ error: 'action must be "remove", or "edit" with newText' }, { status: 400 });
}
