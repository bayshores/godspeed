import { createContext } from "react";

/**
 * Server-sync channel for artifact renderers: the jobs fetch calls
 * syncFromServer() when a background job settles; sendText feeds the demo
 * error-fix loop. (contracts.ts "THE ASYNC PROTOCOL" §4.) Its own module so
 * the artifact cards don't import chat.tsx, which renders them.
 */
export const ChatActionsContext = createContext<{
	chatId: string;
	syncFromServer: () => Promise<void>;
	/** Why a question, problem or compaction holds the message box, or null when text can go. */
	sendBlocked: string | null;
	sendText: (text: string) => void;
} | null>(null);
