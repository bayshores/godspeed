import { createContext } from "react";
import type { KeptPart } from "@/shared/core";

/**
 * What cards get from the lesson: the chat id, the writing box's send rules
 * (sendText, sendBlocked), a kept card's drop and bring back and the open
 * problem's call id (its card waits until it closes). Its own
 * module so the cards don't import chat.tsx, which renders them.
 */
export const ChatActionsContext = createContext<{
	chatId: string;
	/** Why a question, problem or compaction holds the writing box, or null when text can go. */
	sendBlocked: string | null;
	sendText: (text: string) => void;
	dropKept: (of: string, part: KeptPart, back: boolean) => void;
	openProblem: string | null;
} | null>(null);
