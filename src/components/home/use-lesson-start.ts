import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { deadlineStudyTopicIds, type DeadlineProgress, type FactProgress, type GraphContextPick, type ProgressPayload, type TopicProgress } from "@/core";
import { useClasses } from "@/components/class-context";
import { studyPicks, studyTitle } from "./study-start-model";

const LESSON_START_FAILED = "Couldn't start the lesson. Try again.";

interface LessonRequest {
	/** The lesson's title and first message. */
	title: string;
	/** Facts the lesson starts from (the server writes them into its
	 *  opening context and groups them into the study's topics). */
	picks?: readonly GraphContextPick[];
}

/**
 * Every Study start (the start page, its suggestions, a deadline, the
 * Graph, the Overview) goes through here, in the active class. The lesson
 * runs on the outside agent; with no agent connected it waits in the agent
 * queue (the lesson shows "Waiting for your agent"). A start that fails
 * sets `error` for the screen to show.
 */
export function useLessonStart() {
	const router = useRouter();
	const { active } = useClasses();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const start = useCallback(
		async (req: LessonRequest) => {
			const title = req.title.trim();
			if (!title || busy) return;
			setBusy(true);
			setError(null);
			try {
				const res = await fetch("/api/chats", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						title,
						...(req.picks && req.picks.length > 0 ? { graphContext: { propositions: req.picks } } : {}),
						...(active ? { classId: active } : {}),
					}),
				});
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const { id } = (await res.json()) as { id: string };
				router.push(`/chat/${id}?prompt=${encodeURIComponent(title)}`);
			} catch {
				setBusy(false);
				setError(LESSON_START_FAILED);
			}
		},
		[busy, active, router],
	);

	/** Study some topics: their facts are the picks. */
	const studyTopics = useCallback(
		(topics: readonly TopicProgress[], facts: readonly FactProgress[]) => {
			if (topics.length > 0) void start({ title: studyTitle(topics), picks: studyPicks(topics, facts) });
		},
		[start],
	);

	/** Study for a deadline: today's planned topics (all its topics once
	 *  every one is strong). One with no topics yet is studied by name. */
	const studyDeadline = useCallback(
		(progress: Pick<ProgressPayload, "today" | "topics" | "facts">, deadline: DeadlineProgress) => {
			const topics = deadlineStudyTopicIds(progress.today, deadline)
				.map((id) => progress.topics.find((t) => t.id === id))
				.filter((t): t is TopicProgress => t !== undefined);
			if (topics.length > 0) studyTopics(topics, progress.facts);
			else void start({ title: `Study for ${deadline.name}` });
		},
		[start, studyTopics],
	);

	return {
		start,
		studyTopics,
		studyDeadline,
		busy,
		error,
	};
}
