/**
 * /api/spaces/[id]/prep
 *  GET  — the prep's view (PrepView)
 *  POST — one action:
 *    { action: "write" }                 ask the teacher to write the sheet again
 *    { action: "add-topic", name }       one more topic at the end
 *    { action: "remove-topic", topicId }
 *    { action: "date", date }            YYYY-MM-DD, or null for no date
 */
import { changePrep, prepView, startWrite } from "@/backend/server";
import { isCalendarDate, isSpaceId } from "@/shared/core";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
type Result = { ok: true } | { ok: false; status: number; error: string };

const reply = (r: Result) => (r.ok ? Response.json({ ok: true }) : Response.json({ error: r.error }, { status: r.status }));
const notFound = () => Response.json({ error: "No such prep" }, { status: 404 });
const bad = (error: string) => Response.json({ error }, { status: 400 });

export async function GET(_req: Request, { params }: Ctx) {
	const { id } = await params;
	if (!isSpaceId(id)) return notFound();
	const view = prepView(id);
	return view.ok ? Response.json(view.value) : Response.json({ error: view.error }, { status: view.status });
}

export async function POST(req: Request, { params }: Ctx) {
	const { id } = await params;
	if (!isSpaceId(id)) return notFound();
	const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
	switch (body.action) {
		case "write":
			return reply(startWrite(id));
		case "add-topic":
			if (typeof body.name !== "string") return bad("Give name.");
			return reply(changePrep(id, { addTopics: [{ name: body.name }] }));
		case "remove-topic":
			if (typeof body.topicId !== "string") return bad("Give topicId.");
			return reply(changePrep(id, { removeTopicIds: [body.topicId] }));
		case "date":
			if (body.date !== null && !isCalendarDate(body.date)) return bad("Give date as YYYY-MM-DD, or null.");
			return reply(changePrep(id, { date: body.date }));
		default:
			return bad("Unknown action.");
	}
}
