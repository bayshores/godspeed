import type { CompactionDetails } from "@/core";
import { pagesLabel } from "@/components/usage-format";

/** What one divider carries: the marker's full model-facing content (the
 *  [SESSION HISTORY COMPACTED] header + the summary) and its details.
 *  The content is deliberately UNRENDERED: the compaction summary is
 *  model-facing plumbing. The dividers mark
 *  WHERE the cut landed and how big it was; nothing opens. */
export interface CompactionDividerData {
	content: string;
	details: CompactionDetails;
}

/** The moment divider: minimal centered small text where
 *  the user currently is — the retrying-message register (SystemLine's
 *  exact classes), NO horizontal rule. The transcript's quiet note that
 *  history was just summarized; the cut divider below carries the seam.
 *  Plain text, no affordance. */
export function CompactionMomentDivider({ data: _data }: { data: CompactionDividerData }) {
	return (
		<div className="flex w-full items-center justify-center py-1">
			<span data-testid="compaction-divider" className="px-1.5 text-xs text-muted-foreground/70">
				Lesson summarized
			</span>
		</div>
	);
}

/** The cut divider: the LONGER divider at the actual
 *  compaction cut — the seam where verbatim history ends and the kept
 *  recent tail begins. Phase-divider's geometry (dotted rules + centered
 *  chip) so it reads as a transcript boundary, not a message. Inert: it
 *  shows the summarized length only. */
export function CompactionCutDivider({ data }: { data: CompactionDividerData }) {
	const length = data.details.tokensBefore > 0 ? ` · ${pagesLabel(data.details.tokensBefore)}` : "";
	return (
		<div data-testid="compaction-cut-divider" className="my-4 flex w-full items-center gap-3">
			<span className="h-0 flex-1 border-t-2 border-dotted border-border/50" aria-hidden />
			<span className="border border-border/80 px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
				Earlier messages summarized{length}
			</span>
			<span className="h-0 flex-1 border-t-2 border-dotted border-border/50" aria-hidden />
		</div>
	);
}
