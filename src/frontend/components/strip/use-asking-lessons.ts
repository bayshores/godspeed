import { useState } from "react";
import { useServerEvent } from "@/frontend/components/server-events";

/**
 * The lessons whose teacher waits for the learner to allow something, oldest first, from each
 * lesson's work event (`asking`), for the strip's "needs you" on any page. A question that began
 * before the window opened shows on its lesson's desk.
 */
export function useAskingLessons(): readonly string[] {
	const [asking, setAsking] = useState<readonly string[]>([]);
	useServerEvent("lesson-work", ({ chatId, asking: waits }) =>
		setAsking((prev) => {
			const has = prev.includes(chatId);
			if (waits === has) return prev;
			return waits ? [...prev, chatId] : prev.filter((id) => id !== chatId);
		}),
	);
	return asking;
}
