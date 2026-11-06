import { createContext } from "react";

/**
 * What artifact cards get from the lesson: the chat id and the message box's
 * send rules (sendText, sendBlocked). Its own module so the cards don't
 * import chat.tsx, which renders them.
 */
export const ChatActionsContext = createContext<{
	chatId: string;
	/** Why a question, problem or compaction holds the message box, or null when text can go. */
	sendBlocked: string | null;
	sendText: (text: string) => void;
} | null>(null);
