import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { FactProgress, GraphContextPick, TopicProgress } from "@/core";
import { useClasses } from "@/components/class-context";
import { practicePicks, practiceTitle } from "@/components/graph/practice";

export interface LessonRequest {
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
 * "Waiting for your agent").
 */
export function useLessonStart() {
	const router = useRouter();
	const { active } = useClasses();
	const [busy, setBusy] = useState(false);

	const start = useCallback(
		async (req: LessonRequest) => {
			const title = req.title.trim();
			if (!title || busy) return;
			setBusy(true);
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
	};
}
