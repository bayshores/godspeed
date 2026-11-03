import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { DeadlineProgress, GraphContextPick } from "@/core";
import { useClasses } from "@/components/class-context";

const LESSON_START_FAILED = "Couldn't start the lesson. Try again.";

/** What a start sends POST /api/chats: a typed topic (its title and any
 *  facts picked for it), some class topics, or a deadline. On topics or a
 *  deadline the server picks the session's topics and writes its title. */
type StartBody =
	| { title: string; graphContext?: { propositions: readonly GraphContextPick[] } }
	| { topicIds: readonly string[] }
	| { deadlineId: string };

/**
 * Every Study start (the start page, its suggestions, a deadline, the
 * Graph, the Overview) goes through here, in the active class. The lesson
 * runs on the outside agent; with no agent connected it waits in the agent
 * queue (the lesson shows "Waiting for your agent"). The session's title,
 * as the server returns it, is its first message. A start that fails sets
 * `error` for the screen to show.
 */
export function useLessonStart() {
	const router = useRouter();
	const { active } = useClasses();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const post = useCallback(
		async (body: StartBody) => {
			if (busy) return;
			setBusy(true);
			setError(null);
			try {
				const res = await fetch("/api/chats", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ ...body, ...(active ? { classId: active } : {}) }),
				});
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const { id, title } = (await res.json()) as { id: string; title: string };
				router.push(`/chat/${id}?prompt=${encodeURIComponent(title)}`);
			} catch {
				setBusy(false);
				setError(LESSON_START_FAILED);
			}
		},
		[busy, active, router],
	);

	/** Study a typed topic, with any facts picked for it. */
	const start = useCallback(
		(req: { title: string; picks?: readonly GraphContextPick[] }) => {
			const title = req.title.trim();
			if (title) return post({ title, ...(req.picks && req.picks.length > 0 ? { graphContext: { propositions: req.picks } } : {}) });
		},
		[post],
	);

	/** Study some of the class's topics. */
	const studyTopics = useCallback(
		(topicIds: readonly string[]) => {
			if (topicIds.length > 0) return post({ topicIds });
		},
		[post],
	);

	/** Study for a deadline: reopens its unfinished session, else starts
	 *  on the next of today's topics that need work. */
	const studyDeadline = useCallback(
		(deadline: Pick<DeadlineProgress, "id" | "continueStudy">) => {
			if (deadline.continueStudy) router.push(`/chat/${deadline.continueStudy.chatId}`);
			else return post({ deadlineId: deadline.id });
		},
		[post, router],
	);

	return {
		start,
		studyTopics,
		studyDeadline,
		busy,
		error,
	};
}
