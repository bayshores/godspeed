import { useBoot } from "@/frontend/components/boot";
import { ChatWindow } from "@/frontend/components/teacher/chat-window";
import { AppProviders } from "./app-providers";

/** The page of the window the teacher panel's chat pops out to: the providers every window has, and
 *  no app frame. */
export function ChatWindowRoute() {
	const { boot } = useBoot();
	return (
		<AppProviders boot={boot} inChatWindow>
			<title>godspeed</title>
			<ChatWindow />
		</AppProviders>
	);
}
