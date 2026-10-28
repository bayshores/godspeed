/** The app-wide message id shape (same as the UIMessage-era mint). Its own
 *  module so compaction.ts and native-messages.ts don't import each other. */
export function newMessageId(): string {
	return `msg_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}
