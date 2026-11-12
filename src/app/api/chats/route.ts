import { type GraphContextPick, isMockId, parseSpaceScope } from "@/shared/core";
import { createHomework, createLesson, isTurnRunning, listChats, startSpaceScanner } from "@/backend/server";
import type { ChatListItem } from "@/shared/core";

/** The session picker's list: record-derived summaries (phase, pending
 *  question) + live liveness: a running turn marks the session busy
 *  (contracts.ts ChatListItem; the store can't see liveness, the route is
 *  the merge point). Background jobs do not count: the transcript's
 *  dispatch cards are their channel (a running mark per row would
 *  double-signal them), so busy means exactly "a teach turn is in
 *  flight".
 *
 *  ?space=<id|none> narrows the list to one
 *  space's lessons ("none" = No space); absent = every lesson. */
export async function GET(req: Request) {
	startSpaceScanner();
	const raw = new URL(req.url).searchParams.get("space");
	const scope = raw === null ? undefined : parseSpaceScope(raw);
	if (raw !== null && scope === undefined) return Response.json({ error: "bad space" }, { status: 400 });
	const chats: ChatListItem[] = listChats()
		.filter((c) => scope === undefined || (c.spaceId ?? null) === scope)
		.map((c) => ({
			...c,
			busy: isTurnRunning(c.id),
		}));
	return Response.json({ chats });
}

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { title?: unknown; graphContext?: unknown; spaceId?: unknown; topicIds?: unknown; prepTopicIds?: unknown; mockQuestion?: unknown; deadlineId?: unknown; homework?: unknown };
	const title = typeof body.title === "string" ? body.title : "";
	// The lesson's space (absent/"none" = No space).
	const spaceId = parseSpaceScope(typeof body.spaceId === "string" ? body.spaceId : undefined);
	if (spaceId === undefined) return Response.json({ error: "bad spaceId" }, { status: 400 });
	// A new lesson is a study session (src/backend/server/lessons.ts), or with
	// homework: true a homework session on the deadline (homework.ts). A start
	// on topics or a deadline gets its topics and title from the server.
	if (body.homework === true) {
		if (typeof spaceId !== "string" || typeof body.deadlineId !== "string") return Response.json({ error: "homework needs a spaceId and a deadlineId" }, { status: 400 });
		const homework = createHomework(spaceId, body.deadlineId);
		if (!homework.ok) return Response.json({ error: homework.error, code: homework.code }, { status: homework.status });
		return Response.json({ id: homework.chat.id, title: homework.title });
	}
	const mockQuestion = mockQuestionOf(body.mockQuestion);
	const created =
		typeof body.deadlineId === "string"
			? createLesson({ spaceId, deadlineId: body.deadlineId })
			: mockQuestion
				? createLesson({ spaceId, mockQuestion })
				: Array.isArray(body.topicIds)
					? createLesson({ spaceId, topicIds: strings(body.topicIds) })
					: Array.isArray(body.prepTopicIds)
						? createLesson({ spaceId, prepTopicIds: strings(body.prepTopicIds) })
						: createLesson({ spaceId, title, picks: picksOf(body.graphContext) });
	if (!created.ok) return Response.json({ error: created.error, code: created.code }, { status: created.status });
	return Response.json({ id: created.chat.id, title: created.title });
}

function mockQuestionOf(raw: unknown): { mockId: string; questionId: string } | null {
	const q = raw as { mockId?: unknown; questionId?: unknown } | null | undefined;
	return q && isMockId(q.mockId) && typeof q.questionId === "string" ? { mockId: q.mockId, questionId: q.questionId } : null;
}

const strings = (list: unknown[]) => list.filter((id): id is string => typeof id === "string");

function picksOf(graphContext: unknown): GraphContextPick[] {
	// The session's map context: the picked
	// propositions ride the CREATION as a graph-context marker (a separate
	// custom message BEFORE the learner's first user message), carrying
	// the picks plus the reasoning chains among them (src/backend/server/lessons.ts).
	const rawPicks = (graphContext as { propositions?: unknown } | undefined)?.propositions;
	return Array.isArray(rawPicks)
		? rawPicks.filter(
				(p): p is GraphContextPick =>
					typeof p === "object" &&
					p !== null &&
					typeof (p as GraphContextPick).id === "string" &&
					typeof (p as GraphContextPick).name === "string" &&
					typeof (p as GraphContextPick).statement === "string",
			)
		: [];
}
