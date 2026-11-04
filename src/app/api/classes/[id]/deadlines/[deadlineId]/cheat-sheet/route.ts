/**
 * /api/classes/[id]/deadlines/[deadlineId]/cheat-sheet
 *  GET  — the studio's view (CheatSheetView)
 *  POST — one action:
 *    { action: "ask", text, attachments? }   make the sheet, or change it, as asked
 *    { action: "retry" }                     send the failed request again
 *    { action: "stop" }                      stop the agent's request
 */
import { askCheatSheet, cheatSheetView, retryCheatSheet, stopCheatSheet } from "@/server";
import { ChatInputError, isClassId, parseAttachments } from "@/core";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; deadlineId: string }> };
type Result = { ok: true; value: unknown } | { ok: false; status: number; error: string };

const reply = (r: Result) => (r.ok ? Response.json({ ok: true }) : Response.json({ error: r.error }, { status: r.status }));
const notFound = () => Response.json({ error: "No such class" }, { status: 404 });
const bad = (error: string) => Response.json({ error }, { status: 400 });

export async function GET(_req: Request, { params }: Ctx) {
	const { id, deadlineId } = await params;
	if (!isClassId(id)) return notFound();
	const view = cheatSheetView(id, deadlineId);
	return view.ok ? Response.json(view.value) : Response.json({ error: view.error }, { status: view.status });
}

export async function POST(req: Request, { params }: Ctx) {
	const { id, deadlineId } = await params;
	if (!isClassId(id)) return notFound();
	const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
	switch (body.action) {
		case "ask": {
			if (typeof body.text !== "string") return bad("Give text.");
			let attachments;
			try {
				attachments = parseAttachments(body.attachments);
			} catch (err) {
				if (err instanceof ChatInputError) return bad(err.message);
				throw err;
			}
			return reply(await askCheatSheet(id, deadlineId, { text: body.text, ...(attachments ? { attachments } : {}) }));
		}
		case "retry":
			return reply(retryCheatSheet(id, deadlineId));
		case "stop":
			stopCheatSheet(deadlineId);
			return Response.json({ ok: true });
		default:
			return bad("Unknown action.");
	}
}
