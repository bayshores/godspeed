import { type GraphContextPick, parseClassScope } from "@/core";
import { compactionInFlight, createLesson, isTurnRunning, listChats, startClassScanner } from "@/server";
import type { ChatListItem } from "@/core";

/** The session picker's list: record-derived summaries (phase, pending
 *  question) + live liveness — a running turn marks the session busy
 *  (contracts.ts ChatListItem; the store can't see liveness, the route is
 *  the merge point). Background jobs do not count: the sidebar's
 *  Background agents section is their channel (a running spinner per row
 *  would double-signal them), so busy means exactly "a teach turn is in
 *  flight".
 *
 *  ?class=<id|none> narrows the list to one
 *  class's lessons ("none" = No class); absent = every lesson. */
export async function GET(req: Request) {
	startClassScanner();
	const raw = new URL(req.url).searchParams.get("class");
	const scope = raw === null ? undefined : parseClassScope(raw);
	if (raw !== null && scope === undefined) return Response.json({ error: "bad class" }, { status: 400 });
	const chats: ChatListItem[] = listChats()
		.filter((c) => scope === undefined || (c.classId ?? null) === scope)
		.map((c) => ({
			...c,
			busy: isTurnRunning(c.id),
			compacting: compactionInFlight(c.id),
		}));
	return Response.json({ chats });
}

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { title?: unknown; graphContext?: unknown; classId?: unknown; topicIds?: unknown; deadlineId?: unknown };
	const title = typeof body.title === "string" ? body.title : "";
	// The lesson's class (absent/"none" = No class).
	const classId = parseClassScope(typeof body.classId === "string" ? body.classId : undefined);
	if (classId === undefined) return Response.json({ error: "bad classId" }, { status: 400 });
	// Every new lesson is a study session (src/server/lessons.ts). A start
	// on topics or a deadline gets its topics and title from the server.
	const created =
		typeof body.deadlineId === "string"
			? createLesson({ classId, deadlineId: body.deadlineId })
			: Array.isArray(body.topicIds)
				? createLesson({ classId, topicIds: body.topicIds.filter((id): id is string => typeof id === "string") })
				: createLesson({ classId, title, picks: picksOf(body.graphContext) });
	if (!created.ok) return Response.json({ error: created.error, code: created.code }, { status: created.status });
	return Response.json({ id: created.chat.id, title: created.title });
}

function picksOf(graphContext: unknown): GraphContextPick[] {
	// The session's map context: the picked
	// propositions ride the CREATION as a graph-context marker (a separate
	// custom message BEFORE the learner's first user message), carrying
	// the picks plus the reasoning chains among them (src/server/lessons.ts).
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
