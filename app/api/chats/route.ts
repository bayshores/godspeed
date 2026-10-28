import { type GraphContextPick, parseClassScope } from "@/src/core";
import { compactionInFlight, createLesson, isTurnRunning, listChats, startClassScanner } from "@/src/server";
import { OUTSIDE_AGENT_MODEL_ID, OUTSIDE_AGENT_PROVIDER } from "@/src/core";
import type { ChatListItem } from "@/src/core";

/** The session picker's list: record-derived summaries (phase, pending
 *  question) + live liveness — a running turn marks the session busy
 *  (contracts.ts ChatListItem; the store can't see liveness, the route is
 *  the merge point). Owner, minimal-color round: background jobs NO LONGER
 *  count — the sidebar's Background agents section is their channel now
 *  (a running spinner per row would double-signal them), so busy means
 *  exactly "a teach turn is in flight".
 *
 *  Classes wave (2026-10-26): ?class=<id|none> narrows the list to one
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
	const body = (await req.json().catch(() => ({}))) as { title?: unknown; kind?: unknown; graphContext?: unknown; classId?: unknown };
	const title = typeof body.title === "string" ? body.title : "";
	// Practice sessions (owner, 2026-10-04): kind "practice" marks the
	// record — the practice agent + its tools from turn 1, no extraction.
	const kind = body.kind === "practice" ? ("practice" as const) : undefined;
	// Classes wave: the lesson's class (absent/"none" = No class).
	const classId = parseClassScope(typeof body.classId === "string" ? body.classId : undefined);
	if (classId === undefined) return Response.json({ error: "bad classId" }, { status: 400 });
	// The session's map context (owner, 2026-10-04): the picked
	// propositions ride the CREATION as a graph-context marker (a separate
	// custom message BEFORE the learner's first user message), carrying
	// the picks plus the reasoning chains among them (src/server/lessons.ts).
	const rawPicks = (body.graphContext as { propositions?: unknown } | undefined)?.propositions;
	const picks: GraphContextPick[] = Array.isArray(rawPicks)
		? rawPicks
				.filter(
					(p): p is GraphContextPick =>
						typeof p === "object" &&
						p !== null &&
						typeof (p as GraphContextPick).id === "string" &&
						typeof (p as GraphContextPick).name === "string" &&
						typeof (p as GraphContextPick).statement === "string",
				)
				.slice(0, 64)
		: [];
	const created = createLesson({
		title,
		kind,
		classId,
		picks,
		// Every lesson runs on the outside agent (owner, 2026-10-27) — the
		// same stamp MCP start_lesson writes.
		settings: { model: { provider: OUTSIDE_AGENT_PROVIDER, id: OUTSIDE_AGENT_MODEL_ID } },
	});
	if (!created.ok) return Response.json({ error: created.error, code: created.code }, { status: created.status });
	return Response.json({ id: created.chat.id, title: created.chat.title });
}
