import { useLocation, useNavigate } from "react-router";
import { useAgentChoice, useAgentFolder } from "@/frontend/components/agent-folder/use-agent-folder";
import { useTerminals } from "@/frontend/components/terminal/use-terminals";
import type { FolderAgent } from "@/shared/core";
import { TeacherChats } from "./teacher-chats";
import { openChatGoesTo } from "./teacher-chats-model";

/** The chats under the panel's Chats key, once the teacher has a screen: a
 *  pick turns a running teacher off and starts it in that chat. The list
 *  goes once that worked (`onDone`); a start that failed says why here.
 *  The chat it runs now goes to its lesson, unless that page is open. */
export function PanelChats({ onDone }: { onDone: () => void }) {
	const { busy, error, changeChat } = useAgentFolder();
	const [choice, setChoice] = useAgentChoice();
	const terminals = useTerminals();
	const { pathname } = useLocation();
	const navigate = useNavigate();
	const running = !!terminals?.teacher && !terminals.teacher.ended;
	const go = (agent: FolderAgent, resume?: string) => void changeChat(agent, resume).then((started) => started && onDone());
	return (
		<div className="flex flex-col gap-3.5">
			<TeacherChats
				chats={terminals?.chats ?? []}
				choice={choice}
				onChoose={setChoice}
				onNew={() => choice !== "other" && go(choice)}
				onResume={(chat) => go(chat.agent, chat.id)}
				busy={busy}
				onOpen={
					running
						? (chat) => {
								const to = openChatGoesTo(chat, pathname);
								if (to) void navigate(to);
								onDone();
							}
						: undefined
				}
			/>
			{error && (
				<p role="alert" className="text-[15px] text-ans-wrong">
					{error}
				</p>
			)}
		</div>
	);
}
