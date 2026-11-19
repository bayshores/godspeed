import { data, useLoaderData, type LoaderFunctionArgs } from "react-router";
import type { HomeworkView, LessonKind } from "@/shared/core";
import { Chat } from "@/frontend/components/chat";
import type { ChatRead } from "@/frontend/components/lesson/use-lesson-server";
import { getJson } from "@/frontend/lib/api";
import { loadJson } from "./load-json";
import { PageTitle } from "./page-title";

/** One lesson: its record (and a homework lesson's deadline) is read before
 *  the page shows, so a navigation keeps the old page until it's ready. */
export async function lessonLoader({ params, request }: LoaderFunctionArgs) {
	// The plan map's code loads with the record, so an unfolded step row draws with the first paint.
	const [read] = await Promise.all([loadJson<ChatRead>(`/api/chats/${encodeURIComponent(params.id ?? "")}`, request.signal), import("@/frontend/components/plan-block")]);
	// An older build's Talk chat is kept on disk but never shown.
	if (read.kind === "talk") throw data(null, { status: 404 });
	const chat = { ...read, kind: read.kind as LessonKind | undefined };
	let homework: HomeworkView | undefined;
	if (chat.kind === "homework" && chat.spaceId && chat.deadlineId) {
		const hw = await getJson<{ homework: HomeworkView }>(`/api/spaces/${chat.spaceId}/deadlines/${encodeURIComponent(chat.deadlineId)}/homework`, request.signal);
		if (hw.body) homework = hw.body.homework;
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
				// A study session's plan is written at birth, or by the agent's
				// plan_init when the space has no topics for it.
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
				initialStats={chat}
			/>
		</>
	);
}
