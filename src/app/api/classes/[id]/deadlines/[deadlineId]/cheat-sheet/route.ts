/**
 * /api/classes/[id]/deadlines/[deadlineId]/cheat-sheet
 *  GET  — the setup's and the studio's view (CheatSheetView)
 *  PUT  — { rules?, prefs? }: save the rules and the choices
 *  POST — one action:
 *    { action: "make", rules?, prefs? }            confirm and write the whole sheet
 *    { action: "read-rules" }                       the setup opened: read the rules from the class's files
 *    { action: "change", how: "tighten" | "redo" | "ask", blockIds, text? }
 *    { action: "add", topicId }                     a left-out topic back on it
 *    { action: "pin", blockId, pinned } | { action: "remove", blockId } | { action: "move", blockId, before: blockId | null }
 *    { action: "stop" }                             stop the agent's request
 */
import { changeCheatSheetBlocks, cheatSheetView, editCheatSheetBlocks, makeCheatSheet, readCheatSheetRules, saveCheatSheet, stopCheatSheet, type BlockEdit } from "@/server";
import { isClassId } from "@/core";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; deadlineId: string }> };
type Result = { ok: true; value: unknown } | { ok: false; status: number; error: string };

const reply = (r: Result) => (r.ok ? Response.json({ ok: true }) : Response.json({ error: r.error }, { status: r.status }));
const notFound = () => Response.json({ error: "No such class" }, { status: 404 });
const bad = (error: string) => Response.json({ error }, { status: 400 });
const isIds = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string");

export async function GET(_req: Request, { params }: Ctx) {
	const { id, deadlineId } = await params;
	if (!isClassId(id)) return notFound();
	const view = cheatSheetView(id, deadlineId);
	return view.ok ? Response.json(view.value) : Response.json({ error: view.error }, { status: view.status });
}

export async function PUT(req: Request, { params }: Ctx) {
	const { id, deadlineId } = await params;
	if (!isClassId(id)) return notFound();
	const body = (await req.json().catch(() => ({}))) as { rules?: unknown; prefs?: unknown };
	return reply(saveCheatSheet(id, deadlineId, body));
}

export async function POST(req: Request, { params }: Ctx) {
	const { id, deadlineId } = await params;
	if (!isClassId(id)) return notFound();
	const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
	switch (body.action) {
		case "make":
			return reply(makeCheatSheet(id, deadlineId, { rules: body.rules, prefs: body.prefs }));
		case "read-rules":
			return reply(readCheatSheetRules(id, deadlineId));
		case "change": {
			const how = body.how;
			if ((how !== "tighten" && how !== "redo" && how !== "ask") || !isIds(body.blockIds)) return bad("Give how (tighten, redo or ask) and blockIds.");
			return reply(changeCheatSheetBlocks(id, deadlineId, { how, blockIds: body.blockIds, ...(typeof body.text === "string" ? { text: body.text } : {}) }));
		}
		case "add":
			if (typeof body.topicId !== "string") return bad("Give topicId.");
			return reply(changeCheatSheetBlocks(id, deadlineId, { how: "add", topicId: body.topicId }));
		case "pin":
		case "remove":
		case "move": {
			if (typeof body.blockId !== "string") return bad("Give blockId.");
			const edit: BlockEdit =
				body.action === "pin"
					? { kind: "pin", blockId: body.blockId, pinned: body.pinned === true }
					: body.action === "remove"
						? { kind: "remove", blockId: body.blockId }
						: { kind: "move", blockId: body.blockId, before: typeof body.before === "string" ? body.before : null };
			return reply(editCheatSheetBlocks(id, deadlineId, edit));
		}
		case "stop":
			stopCheatSheet(deadlineId);
			return Response.json({ ok: true });
		default:
			return bad("Unknown action.");
	}
}
