import { useState } from "react";
import { useSettings } from "@/frontend/components/settings-context";
import { readStorage, writeStorage } from "@/frontend/lib/storage";
import { SHOWN_CHAT_KEY } from "./dock-model";
import { PanelHead } from "./panel-head";
import { TalkChatView } from "./talk-chat";
import { putBackChat } from "./use-chat-window";
import { useTalkChats } from "./use-talk-chats";

/**
 * The page of the window the panel's chat pops out to: the same chat, at its end, with a head
 * holding only Put back. It has no teacher provider, so the head shows no Follow or Chats. A chat
 * made here is the one the panel shows when it is put back. On the Mac the head is the window's
 * title bar: it drags the window and leaves the traffic lights their gutter.
 */
export function ChatWindow() {
	const name = useSettings().teacherName;
	const chats = useTalkChats();
	const [chatId, setChatId] = useState(() => readStorage(SHOWN_CHAT_KEY) || null);
	const show = (id: string) => {
		writeStorage(SHOWN_CHAT_KEY, id);
		setChatId(id);
	};
	const row = chats?.find((c) => c.id === chatId) ?? null;
	return (
		// The teacher panel's colors on a whole window: no pop-up corners, no edge line.
		<main data-testid="chat-window" className="lh-popup lh-popup-window flex h-dvh min-w-0 flex-col overflow-hidden font-ui">
			<div className="lh-drag lh-lights-gutter shrink-0 select-none">
				<PanelHead name={name} working={!!row?.running} elsewhere={false} list={null} popOut={null} putBack={putBackChat} blocked={false} />
			</div>
			<div className="lh-page-colors flex min-h-0 flex-1 flex-col">
				<TalkChatView chatId={chatId} chat={row} onChat={show} name={name} noBox={false} ask={null} focus />
			</div>
		</main>
	);
}
