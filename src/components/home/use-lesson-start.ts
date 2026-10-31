import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { FactProgress, GraphContextPick, TopicProgress } from "@/core";
import { useClasses } from "@/components/class-context";
import { PRACTICE_START_FAILED, practicePicks, practiceTitle } from "@/components/graph/practice";

const LESSON_START_FAILED = "Couldn't start the lesson. Try again.";

interface LessonRequest {
	/** The lesson's title and first message. */
	title: string;
	kind?: "teach" | "practice";
	/** Facts the lesson starts from (the server writes them into its
	 *  opening context). */
	picks?: readonly GraphContextPick[];
}

/**
 * Every lesson Home starts (the topic box, Learn this, Practice) goes
 * through here, in the active class. The lesson runs on the outside agent;
 * with no agent connected it waits in the agent queue (the lesson shows
 * "Waiting for your agent"). A start that fails sets `error` for the
 * screen to show.
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
						...(req.kind === "practice" ? { kind: "practice" } : {}),
						...(req.picks && req.picks.length > 0 ? { graphContext: { propositions: req.picks } } : {}),
						...(active ? { classId: active } : {}),
					}),
				});
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const { id } = (await res.json()) as { id: string };
				router.push(`/chat/${id}?prompt=${encodeURIComponent(title)}`);
			} catch {
				setBusy(false);
				setError(req.kind === "practice" ? PRACTICE_START_FAILED : LESSON_START_FAILED);
			}
		},
		[busy, active, router],
	);

	/** "Practice" on a Work-on-next topic: the same lesson the Graph's
	 *  "Practice this topic" starts. */
	const practiceTopic = useCallback(
		(topic: TopicProgress, facts: readonly FactProgress[]) =>
			start({ title: practiceTitle([topic]), kind: "practice", picks: practicePicks([topic], facts) }),
		[start],
	);

	return {
		start,
		practiceTopic,
		busy,
		error,
	};
}
