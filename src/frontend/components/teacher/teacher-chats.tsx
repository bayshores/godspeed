import { AGENT_LABEL, type LaunchChoice } from "@/frontend/components/agent-folder/agent-folder-model";
import { AgentMenu } from "@/frontend/components/agent-folder/start-agent-button";
import type { TeacherChat } from "@/frontend/components/terminal/terminal-model";
import { useNow } from "@/frontend/components/use-now";
import { agoLabel } from "./activity-model";

/**
 * Before the teacher starts, with earlier chats: New chat (with the agent
 * menu beside it), then the newest chats to go back to, each with how long
 * ago it was used. An agent's name shows only when both agents have chats.
 * Older ones: `/resume` inside the agent.
 */
export function TeacherChats({
	chats,
	choice,
	onChoose,
	onNew,
	onResume,
	busy,
}: {
	chats: readonly TeacherChat[];
	choice: LaunchChoice;
	onChoose: (choice: LaunchChoice) => void;
	onNew: () => void;
	onResume: (chat: TeacherChat) => void;
	busy: boolean;
}) {
	const now = useNow(true, 60_000);
	const mixed = new Set(chats.map((c) => c.agent)).size > 1;
	return (
		<div data-testid="teacher-chats" className="flex w-full max-w-[420px] flex-col gap-3.5 text-left">
			<div className="flex flex-wrap items-center gap-2.5">
				<button type="button" data-testid="teacher-chat-new" disabled={busy} onClick={onNew} className="lh-btn lh-btn-main text-[15px]">
					New chat
				</button>
				<AgentMenu choice={choice} onChoose={onChoose} className="text-[15px]" />
			</div>
			<div className="flex flex-col gap-1">
				{chats.map((chat) => (
					<button
						key={chat.id}
						type="button"
						data-testid="teacher-chat"
						disabled={busy}
						onClick={() => onResume(chat)}
						className="lh-press flex w-full items-baseline gap-3 rounded px-2.5 py-2 text-left text-[15px] hover:bg-tone disabled:cursor-default"
					>
						<span className="min-w-0 flex-1 truncate text-ink" title={chat.name ?? undefined}>
							{chat.name ?? "A chat"}
							{mixed && <span className="text-ink-2">, {AGENT_LABEL[chat.agent]}</span>}
						</span>
						<span className="shrink-0 font-count text-ink-2">{agoLabel(new Date(chat.at).toISOString(), now)}</span>
					</button>
				))}
			</div>
		</div>
	);
}
