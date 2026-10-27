import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { FactProgress, GraphContextPick, TopicProgress } from "@/src/core";
import { useClasses } from "@/components/class-context";
import { useNoConnection, useStrongDisconnected } from "@/components/setup-cta";
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
 * through here: in the active class, behind the setup checks. Not ready
 * to send (no models picked, no subscription signed in, or the strong
 * model's provider signed out) opens the setup dialog instead; checking
 * before the create means a refused start never leaves an empty lesson
 * behind. The draft in the topic box is untouched either way.
 */
export function useLessonStart(initialConfigured: boolean) {
	const router = useRouter();
	const { active } = useClasses();
	const noConnection = useNoConnection();
	const strongDisconnected = useStrongDisconnected();
	const [configured, setConfigured] = useState(initialConfigured);
	const [setupOpen, setSetupOpen] = useState(false);
	const [busy, setBusy] = useState(false);

	const start = useCallback(
		async (req: LessonRequest) => {
			const title = req.title.trim();
			if (!title || busy) return;
			if (!configured || noConnection || strongDisconnected) {
				setSetupOpen(true);
				return;
			}
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
		[busy, configured, noConnection, strongDisconnected, active, router],
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
		/** Nothing is connected: the top bar offers sign-in. */
		noConnection,
		configured,
		setupOpen,
		openSetup: () => setSetupOpen(true),
		closeSetup: () => setSetupOpen(false),
		/** Save only saves: a draft in the topic box waits for the learner. */
		setupDone: () => {
			setConfigured(true);
			setSetupOpen(false);
		},
	};
}
