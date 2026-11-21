import { data, useLoaderData, type LoaderFunctionArgs } from "react-router";
import type { JobRecord, LessonDocuments, LessonKind, LessonProblemList } from "@/shared/core";
import { Chat } from "@/frontend/components/chat";
import { askFromEarlier } from "@/frontend/components/lesson/use-from-earlier";
import type { ChatRead } from "@/frontend/components/lesson/use-lesson-server";
import { getJson } from "@/frontend/lib/api";
import { loadJson } from "./load-json";
import { PageTitle } from "./page-title";

/** One lesson: its record, its jobs and the question from earlier it may
 *  show (and a homework lesson's or a lesson on files' problem list and
 *  documents) are read before the page shows, so a navigation keeps the old
 *  page until it's ready and the lesson opens with nothing left to arrive. */
export async function lessonLoader({ params, request }: LoaderFunctionArgs) {
	// The plan map's code loads with the record, so an unfolded step row draws with the first paint.
	const id = params.id ?? "";
	const [read, listedJobs, review] = await Promise.all([
		loadJson<ChatRead>(`/api/chats/${encodeURIComponent(id)}`, request.signal),
		getJson<{ jobs?: JobRecord[] }>(`/api/jobs?chatId=${encodeURIComponent(id)}`, request.signal),
		askFromEarlier(id, request.signal),
		import("@/frontend/components/plan-block"),
	]);
	// An older build's Talk chat is kept on disk but never shown.
	if (read.kind === "talk") throw data(null, { status: 404 });
	const chat = { ...read, kind: read.kind as LessonKind | undefined };
	let problemList: LessonProblemList | undefined;
	// null: a lesson with documents whose read failed, so the page reads them again.
	let documents: LessonDocuments | null | undefined;
	if (chat.kind === "homework" || (chat.kind === "study" && chat.fileIds?.length)) {
		const at = `/api/chats/${encodeURIComponent(chat.id)}`;
		const [listed, shown] = await Promise.all([getJson<{ problems: LessonProblemList }>(`${at}/problems`, request.signal), getJson<LessonDocuments>(`${at}/documents`, request.signal)]);
		if (listed.body) problemList = listed.body.problems;
		documents = shown.body;
	}
	return { chat, jobs: listedJobs.body ? (listedJobs.body.jobs ?? []) : null, review, problemList, documents, prompt: new URL(request.url).searchParams.get("prompt") ?? undefined };
}

export function LessonPage() {
	const { chat, jobs, review, problemList, documents, prompt } = useLoaderData<typeof lessonLoader>();
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
				problemList={problemList}
				documents={documents}
				// The record IS native agent history; the client view is derived
				// app-side (core/view.ts projectView).
				initialMessages={chat.messages}
				initialError={chat.turnError}
				initialPrompt={prompt}
				// A teacher turn that outlived its client: the remounted view must
				// attach (busy shimmer + poll), never resurrect the stale record.
				initiallyInFlight={chat.turnInFlight}
				initialStats={chat}
				initialJobs={jobs}
				openedReview={review}
			/>
		</>
	);
}
