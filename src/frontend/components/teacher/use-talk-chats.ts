import { useMemo } from "react";
import { readTalkChats, type TalkChat } from "@/shared/core";
import { useServerResource } from "@/frontend/components/use-server-resource";

/** The teacher panel's chats, newest first, read again when a chat is made, renamed or removed and
 *  when one of its replies starts or ends. Null before the first read. */
export function useTalkChats(): readonly TalkChat[] | null {
	const { value } = useServerResource<unknown>("/api/chats?kind=talk", { on: { "chats-changed": true, "turn-started": true, "turn-settled": true } });
	return useMemo(() => (value === null ? null : readTalkChats(value)), [value]);
}
