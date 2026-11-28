import type { CompactionDetails } from "@/shared/core";
import { pagesLabel } from "@/frontend/components/usage-format";

/** What the divider carries: the marker's full model-facing content (the
 *  [SESSION HISTORY COMPACTED] header + the summary) and its details.
 *  The content is deliberately UNRENDERED: the compaction summary is
 *  model-facing plumbing. The divider marks
 *  WHERE the cut landed and how big it was; nothing opens. */
export interface CompactionDividerData {
	content: string;
	details: CompactionDetails;
}

/** The cut divider: the LONGER divider at the actual
 *  compaction cut — the seam where verbatim history ends and the kept
 *  recent tail begins. Phase-divider's geometry (a shaded strip with centered
 *  words) so it reads as a transcript boundary, not a message. Inert: it
 *  shows the summarized length only. */
export function CompactionCutDivider({ data }: { data: CompactionDividerData }) {
	const length = data.details.tokensBefore > 0 ? `, ${pagesLabel(data.details.tokensBefore)}` : "";
	return (
		<div data-testid="compaction-cut-divider" className="my-4 flex w-full items-center justify-center bg-tone px-3 py-1">
			<span className="text-ui text-ink-2">Earlier messages summarized{length}</span>
		</div>
	);
}
