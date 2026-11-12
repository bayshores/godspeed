/**
 * /api/spaces/[id]/mocks/[mockId]
 *  GET    — the mock's view (MockView)
 *  POST   — one action:
 *    { action: "start" }                         start the clock
 *    { action: "answer", questionId, text, language?, code?, seconds, submitted }
 *        code: a code question's code by language; its text is the picked one's
 *    { action: "run", questionId, code, language }   → RunOutcome
 *    { action: "end" }                           end it and ask for grades
 *    { action: "retry" }                         ask the teacher again
 *  DELETE — remove the mock
 */
import { changeMock, deleteMock, mockView, runMockExamples } from "@/backend/server";
import { ANSWER_MAX, isSpaceId, isMockId, isMockLanguage, parseMockCode } from "@/shared/core";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; mockId: string }> };
type Result = { ok: true } | { ok: false; status: number; error: string };

const reply = (r: Result) => (r.ok ? Response.json({ ok: true }) : Response.json({ error: r.error }, { status: r.status }));
const notFound = () => Response.json({ error: "No such mock" }, { status: 404 });
const bad = (error: string) => Response.json({ error }, { status: 400 });

export async function GET(_req: Request, { params }: Ctx) {
	const { id, mockId } = await params;
	if (!isSpaceId(id) || !isMockId(mockId)) return notFound();
	const view = mockView(id, mockId);
	return view.ok ? Response.json(view.value) : Response.json({ error: view.error }, { status: view.status });
}

export async function POST(req: Request, { params }: Ctx) {
	const { id, mockId } = await params;
	if (!isSpaceId(id) || !isMockId(mockId)) return notFound();
	const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
	switch (body.action) {
		case "start":
		case "end":
		case "retry":
			return reply(changeMock(id, mockId, { action: body.action }));
		case "answer": {
			if (typeof body.questionId !== "string" || typeof body.text !== "string" || typeof body.seconds !== "number") return bad("Give questionId, text and seconds.");
			const answer = {
				text: body.text,
				...(isMockLanguage(body.language) ? { language: body.language } : {}),
				code: parseMockCode(body.code),
				seconds: body.seconds,
				submitted: body.submitted === true,
			};
			return reply(changeMock(id, mockId, { action: "answer", questionId: body.questionId, answer }));
		}
		case "run": {
			if (typeof body.questionId !== "string" || typeof body.code !== "string" || body.code.length > ANSWER_MAX) return bad("Give questionId and code.");
			const run = await runMockExamples(id, mockId, { questionId: body.questionId, code: body.code, language: body.language }, req.signal);
			return run.ok ? Response.json(run.value) : Response.json({ error: run.error }, { status: run.status });
		}
		default:
			return bad("Unknown action.");
	}
}

export async function DELETE(_req: Request, { params }: Ctx) {
	const { id, mockId } = await params;
	if (!isSpaceId(id) || !isMockId(mockId)) return notFound();
	return reply(deleteMock(id, mockId));
}
