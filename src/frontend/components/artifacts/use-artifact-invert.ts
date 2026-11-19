import { useContext, useState } from "react";
import { ChatActionsContext } from "@/frontend/components/chat-actions-context";
import { jsonInit, send } from "@/frontend/lib/api";

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
		// Only a convenience: a failed save shows the card as it was next time.
		void send(`/api/chats/${actions.chatId}/artifact-ui`, jsonInit("POST", { input: { messageId, inverted: next } }));
	};
	return [inverted, toggleInverted];
}
