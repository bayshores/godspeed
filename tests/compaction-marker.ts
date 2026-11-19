/**
 * A compaction marker as the Rust server writes it, for tests that read one.
 */
import type { CompactionDetails } from "../src/shared/core/compaction.ts";
import { newMessageId } from "../src/shared/core/message-id.ts";
import type { LhMarkerMessage } from "../src/shared/core/native-messages.ts";

export function newCompactionMarker(summary: string, details: CompactionDetails): LhMarkerMessage {
	return {
		id: newMessageId(),
		role: "custom",
		customType: "compaction",
		content: `[SESSION HISTORY COMPACTED]\n\n${summary.trim()}`,
		display: true,
		details,
		timestamp: Date.now(),
	};
}
