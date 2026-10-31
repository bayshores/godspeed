import { useContext, useState } from "react";
import { ChatActionsContext } from "@/components/chat-actions-context";

/** An artifact card's brightness-inversion switch. The state persists on
 *  the steer record (details.ui.inverted): seeded from `initialInverted`,
 *  written through the silent artifact-ui route on toggle. Without a chat
 *  page (tests, previews) it stays local-only. */
export function useArtifactInvert(messageId: string | undefined, initialInverted: boolean): [boolean, (next: boolean) => void] {
	const actions = useContext(ChatActionsContext);
	const [inverted, setInverted] = useState(initialInverted);
	const toggleInverted = (next: boolean) => {
		setInverted(next);
		if (!actions?.chatId || !messageId) return;
		void fetch(`/api/chats/${actions.chatId}/artifact-ui`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ input: { messageId, inverted: next } }),
		}).catch(() => {});
	};
	return [inverted, toggleInverted];
}
