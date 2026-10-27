/**
 * Practice from the Graph ("Practice these 4", "Practice this topic"):
 * the same path as Home's practice mode — POST /api/chats with
 * kind "practice" and the facts as graphContext picks (the server writes
 * them into the lesson's opening context), then open the lesson with the
 * title as its first message. Not ready to send (no models / no
 * connection) opens the setup dialog instead, like Home.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FactProgress, GraphContextPick, TopicProgress } from "@/core";
import { useClasses } from "@/components/class-context";
import { useNoConnection, useStrongDisconnected } from "@/components/setup-cta";
import { topicFacts } from "./derive.ts";

/** The server keeps at most 64 picks. */
export const MAX_PICKS = 64;

/** The picks for a set of topics: each topic's facts, weakest first,
 *  topics in the given order, capped at MAX_PICKS. */
export function practicePicks(
	topics: readonly Pick<TopicProgress, "members">[],
	facts: readonly FactProgress[],
): GraphContextPick[] {
	const picks: GraphContextPick[] = [];
	for (const t of topics) {
		for (const f of topicFacts(facts, t)) {
			if (picks.length >= MAX_PICKS) return picks;
			picks.push({ id: f.id, name: f.name, statement: f.statement });
		}
	}
	return picks;
}

/** The new lesson's title (and first message). */
export function practiceTitle(topics: readonly Pick<TopicProgress, "name">[]): string {
	return `Practice: ${topics.map((t) => t.name).join(", ")}`;
}

export function usePracticeStart(initialConfigured: boolean) {
	const router = useRouter();
	const { active } = useClasses();
	const noConnection = useNoConnection();
	const strongDisconnected = useStrongDisconnected();
	const [configured, setConfigured] = useState(initialConfigured);
	const [setupOpen, setSetupOpen] = useState(false);
	const [busy, setBusy] = useState(false);

	const start = async (topics: readonly TopicProgress[], facts: readonly FactProgress[]) => {
		if (busy || topics.length === 0) return;
		if (!configured || noConnection || strongDisconnected) {
			setSetupOpen(true);
			return;
		}
		const title = practiceTitle(topics);
		setBusy(true);
		try {
			const res = await fetch("/api/chats", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title,
					kind: "practice",
					graphContext: { propositions: practicePicks(topics, facts) },
					...(active ? { classId: active } : {}),
				}),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const { id } = (await res.json()) as { id: string };
			router.push(`/chat/${id}?prompt=${encodeURIComponent(title)}`);
		} catch {
			setBusy(false);
		}
	};

	return {
		start,
		busy,
		setupOpen,
		closeSetup: () => setSetupOpen(false),
		setupDone: () => {
			setConfigured(true);
			setSetupOpen(false);
		},
	};
}
