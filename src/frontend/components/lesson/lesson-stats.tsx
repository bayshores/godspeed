import type { RefObject } from "react";
import { subscriptionLabels, type SessionPricing, type TurnUsage } from "@/shared/core";
import { MenuShell } from "@/frontend/components/menu-shell";
import { lessonSizeLabel, pagesLabel, planCostLabel } from "@/frontend/components/usage-format";

/** What the lesson's stats are made from. */
export interface LessonUsage {
	turns: TurnUsage[];
	/** The lesson's size now; null while unknown (a summary clears it). */
	contextTokens: number | null;
	/** The lesson size where it gets summarized; null while unknown. */
	summarizeAt: number | null;
	pricing?: SessionPricing;
}

/**
 * The Lesson stats pop-up, hanging from the open lesson's More key.
 *
 * Lessons run on the learner's agent's own plan, so who pays reads as the
 * plan's label; none known stays "–". The size is a separate
 * completed-conversation measurement, never a money-log/summarizer fold or
 * transcript estimate; what it is held against is where the lesson gets
 * summarized (not the agent's own context, which the app can't see).
 */
export function LessonStats({ open, anchorRef, usage }: { open: boolean; anchorRef: RefObject<HTMLElement | null>; usage: LessonUsage }) {
	const { turns, contextTokens, summarizeAt, pricing } = usage;
	const size = lessonSizeLabel(contextTokens, summarizeAt);
	const providers = pricing?.subscriptionProviders ?? subscriptionLabels(turns.map((turn) => turn.model));
	return (
		<MenuShell open={open} anchorRef={anchorRef} testid="stats-detail" role="dialog" label="Lesson stats" preferredSide="down" align="right" hang menuClass="lh-popup flex w-[340px] flex-col gap-1 px-4 py-3.5">
			<h3 className="text-item text-ink">Lesson stats</h3>
			{size !== null && <StatRow label="Lesson size" value={size} testId="stats-size" />}
			<StatRow label="Replies" value={String(turns.length)} />
			<StatRow label="Paid by" value={planCostLabel(providers)} testId="stats-cost" />
			{/* What the size is held against, said once. */}
			{summarizeAt !== null && summarizeAt > 0 && <p className="pt-1 text-ui text-ink-2">Past {pagesLabel(summarizeAt)}, the earlier part is summarized.</p>}
		</MenuShell>
	);
}

function StatRow({ label, value, testId }: { label: string; value: string; testId?: string }) {
	return (
		<div className="flex items-center justify-between gap-2 py-[7px] text-ui text-ink">
			<span className="min-w-0 truncate">{label}</span>
			<span data-testid={testId} className="shrink-0 font-count text-ink-2">
				{value}
			</span>
		</div>
	);
}
