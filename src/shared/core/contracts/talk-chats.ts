/**
 * The teacher panel's chats (GET /api/chats?kind=talk), newest first: each chat's name (its first
 * line), when it was last used, the agent whose session it holds and the model it runs on.
 */
import { isFolderAgent, type FolderAgent } from "../agent-folder.ts";
import { isRecord, isText } from "../is-record.ts";

export interface TalkChat {
	id: string;
	title: string;
	/** ISO time. */
	updatedAt: string;
	/** The agent whose session the chat holds; null before its first reply. */
	agent: FolderAgent | null;
	/** The model its next reply runs on; null for the agent's own default. */
	model: string | null;
	/** A reply is being written. */
	running: boolean;
}

/** The answer made safe to use: rows that are not chats are left out. */
export function readTalkChats(raw: unknown): TalkChat[] {
	const chats = isRecord(raw) && Array.isArray(raw.chats) ? raw.chats : [];
	return chats.flatMap((c): TalkChat[] =>
		isRecord(c) && isText(c.id) && isText(c.title) && isText(c.updatedAt)
			? [{ id: c.id, title: c.title, updatedAt: c.updatedAt, agent: isFolderAgent(c.agent) ? c.agent : null, model: isText(c.model) ? c.model : null, running: c.running === true }]
			: [],
	);
}
