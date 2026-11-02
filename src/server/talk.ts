/**
 * The Talk chat in the teacher's panel: one ongoing chat outside lessons
 * (TALK_CHAT_ID). Opening makes it on first use; Clear deletes it, so the
 * next message starts fresh.
 */
import { TALK_CHAT_ID } from "../core/contracts.ts";
import { stores } from "./stores.ts";
import { deleteChatSession } from "./chats.ts";
import { isTurnRunning } from "./turn-liveness.ts";
import { turnFailure } from "./turn-runs.ts";

/** The Talk chat as the panel opens it. */
export function openTalk() {
	const chat = stores.chatStore.getChat(TALK_CHAT_ID) ?? stores.chatStore.createChat("Talk", "talk");
	return { id: chat.id, messages: chat.messages, turnInFlight: isTurnRunning(chat.id), turnError: turnFailure(chat.id) };
}

/** Empty the Talk chat. Refused while the teacher is replying. */
export async function clearTalk(): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
	if (!stores.chatStore.getChat(TALK_CHAT_ID)) return { ok: true };
	const outcome = await deleteChatSession(TALK_CHAT_ID, "preserve-graph");
	return outcome.ok ? { ok: true } : { ok: false, status: outcome.status, error: outcome.error };
}
