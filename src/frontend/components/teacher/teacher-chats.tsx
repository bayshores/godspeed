import { AGENT_LABEL, type LaunchChoice } from "@/frontend/components/agent-folder/agent-folder-model";
import { AgentMenu } from "@/frontend/components/agent-folder/start-agent-button";
import type { TeacherChat } from "@/frontend/components/terminal/terminal-model";
import { useNow } from "@/frontend/components/use-now";
import { cn } from "@/frontend/lib/utils";
import { agoLabel } from "./activity-model";
import { ACTIVITY_ROW, ACTIVITY_ROWS } from "./activity-look";

const CHAT_ROW = cn(ACTIVITY_ROW, "flex w-full items-baseline gap-3 py-2 text-left text-[15px]");

/**
 * The teacher's chats: New chat (with the agent menu beside it), then the
 * newest chats to go back to, each with how long ago it was used. While
 * the teacher runs (`running`), the chat it is in says "open now" and is
 * no key. An agent's name shows only when both agents have chats. Older
 * ones: `/resume` inside the agent.
 */
export function TeacherChats({
	chats,
	choice,
	onChoose,
	onNew,
	onResume,
	busy,
	running = false,
}: {
	chats: readonly TeacherChat[];
	choice: LaunchChoice;
	onChoose: (choice: LaunchChoice) => void;
	onNew: () => void;
	onResume: (chat: TeacherChat) => void;
	busy: boolean;
	running?: boolean;
}) {
	const now = useNow(true, 60_000);
	const mixed = new Set(chats.map((c) => c.agent)).size > 1;
	return (
		<div data-testid="teacher-chats" className="flex w-full flex-col gap-3.5 text-left">
			<div className="flex flex-wrap items-center gap-2.5">
				<button type="button" data-testid="teacher-chat-new" disabled={busy} onClick={onNew} className="lh-btn lh-btn-main text-[15px]">
					New chat
				</button>
				<AgentMenu choice={choice} onChoose={onChoose} className="text-[15px]" />
			</div>
			<div className={ACTIVITY_ROWS}>
				{chats.map((chat) => {
					const name = (
						<span className="min-w-0 flex-1 truncate text-ink" title={chat.name ?? undefined}>
							{chat.name ?? "A chat"}
							{mixed && <span className="text-ink-2">, {AGENT_LABEL[chat.agent]}</span>}
						</span>
					);
					return running && chat.open ? (
						<div key={chat.id} data-testid="teacher-chat-open" aria-current="true" className={CHAT_ROW}>
							{name}
							<span className="shrink-0 text-ink-2">open now</span>
						</div>
					) : (
						<button key={chat.id} type="button" data-testid="teacher-chat" disabled={busy} onClick={() => onResume(chat)} className={cn(CHAT_ROW, "lh-press hover:bg-(--lh-key-hover) disabled:cursor-default")}>
							{name}
							<span className="shrink-0 font-count text-ink-2">{agoLabel(new Date(chat.at).toISOString(), now)}</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}
