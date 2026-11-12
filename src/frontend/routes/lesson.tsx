import { data, useLoaderData, type LoaderFunctionArgs } from "react-router";
import type { ChatRecord, HomeworkView, LessonKind } from "@/shared/core";
import { Chat } from "@/frontend/components/chat";
import { PageTitle } from "./page-title";

/** GET /api/chats/[id]: the record plus whether a turn is running and the
 *  last turn's failure. */
type ChatRead = ChatRecord & { turnInFlight: boolean; turnError?: string };

/** One lesson: its record (and a homework lesson's deadline) is read before
 *  the page shows, so a navigation keeps the old page until it's ready. */
export async function lessonLoader({ params, request }: LoaderFunctionArgs) {
	// The plan blocks' code loads with the record, so they draw with the first paint.
	const [res] = await Promise.all([
		fetch(`/api/chats/${encodeURIComponent(params.id ?? "")}`, { signal: request.signal }),
		import("@/frontend/components/plan-block"),
	]);
	if (res.status === 404) throw data(null, { status: 404 });
	if (!res.ok) throw new Error(`GET /api/chats/${params.id}: ${res.status}`);
	const read = (await res.json()) as ChatRead;
	// The Talk chat lives in the teacher's panel, never on a lesson page.
	if (read.kind === "talk") throw data(null, { status: 404 });
	const chat = { ...read, kind: read.kind as LessonKind | undefined };
	let homework: HomeworkView | undefined;
	if (chat.kind === "homework" && chat.spaceId && chat.deadlineId) {
		const hw = await fetch(`/api/spaces/${chat.spaceId}/deadlines/${encodeURIComponent(chat.deadlineId)}/homework`, { signal: request.signal });
		if (hw.ok) homework = ((await hw.json()) as { homework: HomeworkView }).homework;
	}
	return { chat, homework, prompt: new URL(request.url).searchParams.get("prompt") ?? undefined };
}

export function LessonPage() {
	const { chat, homework, prompt } = useLoaderData<typeof lessonLoader>();
	return (
		<>
			<PageTitle page={chat.title || "Lesson"} />
			<Chat
				key={chat.id}
				chatId={chat.id}
				title={chat.title}
				kind={chat.kind ?? "teach"}
				// A study session's plan is written at birth, not by a plan_init call.
				initialTree={chat.tree}
				spaceId={chat.spaceId}
				deadlineId={chat.deadlineId}
				homework={homework}
				// The record IS native agent history; the client view is derived
				// app-side (core/view.ts projectView).
				initialMessages={chat.messages}
				initialError={chat.turnError}
				initialPrompt={prompt}
				// A teacher turn that outlived its client: the remounted view must
				// attach (busy shimmer + poll), never resurrect the stale record.
				initiallyInFlight={chat.turnInFlight}
			/>
		</>
	);
}
