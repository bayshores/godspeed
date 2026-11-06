/**
 * /api/classes/[id]/deadlines/[deadlineId]/cheat-sheet
 *  GET  — the sheet's view (CheatSheetView), after taking a newer PDF from its working folder
 *  POST — one action:
 *    { action: "ask", text, attachments?, region?, about? }   a message in the sheet's chat
 *    { action: "retry" }                     send the failed message again
 *    { action: "stop" }                      stop the agent's request
 *    { action: "remove-rule", text }         delete one of the sheet's rules
 *    { action: "file", n }                   → { path }: version n's PDF in the working folder (Show in Finder)
 */
import { askCheatSheet, cheatSheetView, removeSheetRule, retryCheatSheet, sheetPdfFile, stopCheatSheet } from "@/backend/server";
import { ChatInputError, isClassId, parseAttachments, sheetAboutOf, sheetRegionOf } from "@/shared/core";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; deadlineId: string }> };
type Result = { ok: true; value: unknown } | { ok: false; status: number; error: string };

const reply = (r: Result) => (r.ok ? Response.json({ ok: true }) : Response.json({ error: r.error }, { status: r.status }));
const notFound = () => Response.json({ error: "No such class" }, { status: 404 });
const bad = (error: string) => Response.json({ error }, { status: 400 });

export async function GET(_req: Request, { params }: Ctx) {
	const { id, deadlineId } = await params;
	if (!isClassId(id)) return notFound();
	const view = await cheatSheetView(id, deadlineId);
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
			const region = body.region === undefined ? undefined : sheetRegionOf(body.region);
			const about = body.about === undefined ? undefined : sheetAboutOf(body.about);
			if (body.region !== undefined && !region) return bad("Give the region as n, page, x, y, w and h.");
			if (body.about !== undefined && !about) return bad("Give about as kind, session and text.");
			return reply(await askCheatSheet(id, deadlineId, { text: body.text, ...(attachments ? { attachments } : {}), ...(region ? { region } : {}), ...(about ? { about } : {}) }));
		}
		case "retry":
			return reply(retryCheatSheet(id, deadlineId));
		case "remove-rule":
			if (typeof body.text !== "string") return bad("Give text.");
			return reply(removeSheetRule(id, deadlineId, body.text));
		case "file": {
			if (typeof body.n !== "number") return bad("Give n.");
			const file = sheetPdfFile(id, deadlineId, body.n);
			return file.ok ? Response.json({ path: file.value }) : Response.json({ error: file.error }, { status: file.status });
		}
		case "stop":
			stopCheatSheet(deadlineId);
			return Response.json({ ok: true });
		default:
			return bad("Unknown action.");
	}
}
