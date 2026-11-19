/**
 * COMPACTION, the frontend's share: reading a compaction marker. The Rust
 * server writes the marker and shortens the record
 * (crates/core/src/session/compaction.rs). See docs/compaction-accounting.md.
 *
 * A compaction marker (LhMarkerMessage, customType "compaction") carries a
 * summary plus the cut (firstKeptMessageId): the model sees the summary,
 * then every message from the cut onward. Full history stays in the record.
 */

import type { LhMessage, LhMarkerMessage } from "./native-messages.ts";

// ─── the marker ──────────────────────────────────────────────────────────────

/** The compaction marker's details (UI payload — never model-visible;
 * the model sees content, the header + summary). */
export interface CompactionDetails {
	/** Record id of the first KEPT message: the projection renders the
	 * summary, then everything from this message onward. */
	firstKeptMessageId: string;
	/** The estimated context tokens that triggered this compaction
	 * (provenance for the divider's tooltip/dialog). */
	tokensBefore: number;
	/** provider:id of the model that wrote the summary (the session's
	 * own model; provenance, never a routing input). */
	model?: string;
	/** ISO timestamp of the compaction moment. */
	at: string;
	/** godspeed's own shortening, waiting for the model's summary to replace it. */
	local?: boolean;
}

/** The ACTIVE compaction marker: the newest one in the record (chained
 * compactions — the last one rules; older markers fall inside the
 * dropped span and never render). */
export function activeCompactionOf(messages: readonly LhMessage[]): (LhMarkerMessage & { details: CompactionDetails }) | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]!;
		if ((m as { role?: string }).role !== "custom") continue;
		const marker = m as LhMarkerMessage;
		if (marker.customType === "compaction") {
			const details = marker.details as Partial<CompactionDetails>;
			if (typeof details.firstKeptMessageId === "string") {
				return marker as LhMarkerMessage & { details: CompactionDetails };
			}
		}
	}
	return null;
}
