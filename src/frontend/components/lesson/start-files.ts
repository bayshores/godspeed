import type { ChatAttachment } from "@/shared/core";

/** Pictures and PDFs added on the start page wait here, in memory, for the
 *  new session's first message: they are too big for the address that
 *  carries the topic. */
const waiting = new Map<string, readonly ChatAttachment[]>();

export function holdStartFiles(chatId: string, files: readonly ChatAttachment[]): void {
	if (files.length > 0) waiting.set(chatId, files);
}

/** The session's waiting files, handed over once. */
export function takeStartFiles(chatId: string): readonly ChatAttachment[] {
	const files = waiting.get(chatId) ?? [];
	waiting.delete(chatId);
	return files;
}
