/**
 * Messages only old lesson files hold, for tests of reading them back.
 */
import type { AttachmentPart } from "../src/shared/core/attachments.ts";
import type { LhMarkerMessage } from "../src/shared/core/native-messages.ts";

/** A "Your thinking" submission, as lessons saved one before a problem's
 *  work became plain messages. */
export function oldThinkingMessage(problemCallId: string, text: string, attachments: readonly AttachmentPart[] = []): LhMarkerMessage {
	return {
		id: `old_${problemCallId}_${text.length}`,
		role: "custom",
		customType: "practice-thinking",
		content: `Your thinking:\n${text}`,
		...(attachments.length > 0 ? { attachments: [...attachments] } : {}),
		display: true,
		details: { problemCallId, text },
		timestamp: 0,
	};
}
