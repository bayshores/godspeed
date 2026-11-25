import { AGENT_LABEL } from "@/frontend/components/agent-folder/agent-folder-model";
import { useNow } from "@/frontend/components/use-now";
import { cn } from "@/frontend/lib/utils";
import { agoLabel } from "./activity-model";
import { ACTIVITY_ROW, ACTIVITY_ROWS } from "./activity-look";
import { useTeacher } from "./teacher-context";

const CHAT_ROW = cn(ACTIVITY_ROW, "lh-press flex w-full items-baseline gap-3 py-2 text-left text-[15px] hover:bg-(--lh-key-hover)");

/**
 * The chats under the panel's Chats key: New chat, then the chats, newest first, each with its
 * first line and how long ago it was used; the one the panel shows says "open now". An agent's
 * name shows only when both agents have chats. A pick shows that chat, and the list goes.
 */
export function PanelChats({ onDone }: { onDone: () => void }) {
	const teacher = useTeacher();
	const now = useNow(true, 60_000);
	if (!teacher) return null;
	const { chats, chatId } = teacher.talk;
	const list = chats ?? [];
	const mixed = new Set(list.flatMap((c) => (c.agent ? [c.agent] : []))).size > 1;
	const show = (id: string | null) => {
		teacher.showChat(id);
		onDone();
	};
	return (
		<div data-testid="teacher-chats" className="flex w-full flex-col gap-3.5 pt-2 text-left">
			<button type="button" data-testid="teacher-chat-new" onClick={() => show(null)} className="lh-btn lh-btn-main self-start">
				New chat
			</button>
			<div className={ACTIVITY_ROWS}>
				{list.map((chat) => {
					const open = chat.id === chatId;
					return (
						<button key={chat.id} type="button" data-testid={open ? "teacher-chat-open" : "teacher-chat"} aria-current={open || undefined} onClick={() => show(chat.id)} className={CHAT_ROW}>
							<span className="min-w-0 flex-1 truncate text-ink" title={chat.title}>
								{chat.title}
								{mixed && chat.agent && <span className="text-ink-2">, {AGENT_LABEL[chat.agent]}</span>}
							</span>
							<span className={cn("shrink-0 text-ink-2", !open && "font-count")}>{open ? "open now" : agoLabel(chat.updatedAt, now)}</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}
