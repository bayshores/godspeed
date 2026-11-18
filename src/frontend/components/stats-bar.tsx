import { useCallback, useRef, useState } from "react";
import { DEFAULT_TEACHER_NAME, subscriptionLabels, type SessionPricing, type TurnUsage } from "@/shared/core";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { formatTokens, planCostLabel } from "@/frontend/components/usage-format";
import { MenuShell } from "@/frontend/components/menu-shell";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { barWord } from "@/frontend/components/top-bar/bar-look";

/** The meter shows once the lesson is this full (of where it gets summarized). */
const SHOW_AT = 0.8;

/** The meter's text once the lesson nears the size where it gets
 *  summarized ("33k / 40k"); null before that or while either is unknown. */
export function contextMeter(tokens: number | null, limit: number | null): string | null {
	if (tokens === null || limit === null || limit <= 0 || tokens < limit * SHOW_AT) return null;
	return `${formatTokens(tokens)} / ${formatTokens(limit)}`;
}

/** How big the lesson was after a turn: its last step's input, output and cached tokens
 *  (the meter's own measure); "–" when the turn recorded none. */
export function turnSize(turn: TurnUsage): string {
	const last = turn.steps.at(-1);
	if (!last || last.inputTokens === undefined) return "–";
	return formatTokens(last.inputTokens + (last.outputTokens ?? 0) + (last.cacheReadTokens ?? 0) + (last.cacheWriteTokens ?? 0));
}

/**
 * The lesson's size: the session's context window + usage as one word in
 * the top bar, shown once the lesson is 80% of the way to being
 * summarized. Clicking it opens the per-turn detail, hanging from the bar.
 *
 * Lessons run on the outside agent's own plan, so cost reads as the plan's
 * label; missing cost stays "–", never fake zero. Context is a separate
 * completed-conversation measurement, never a money-log/summarizer fold or
 * transcript estimate; its denominator is where the lesson gets summarized
 * (not the agent's own context, which the app can't see).
 * Successful compaction clears it, which hides the meter.
 */
export function StatsBar({
	turns,
	contextTokens = null,
	summarizeAt = null,
	pricing,
}: {
	turns: TurnUsage[];
	contextTokens?: number | null;
	/** The lesson size where it gets summarized; null while unknown. */
	summarizeAt?: number | null;
	pricing?: SessionPricing;
}) {
	const [open, setOpen] = useState(false);
	const teacher = useTeacher()?.name ?? DEFAULT_TEACHER_NAME;
	const anchorRef = useRef<HTMLButtonElement>(null);
	const close = useCallback(() => setOpen(false), []);
	useMenuDismiss(open, close, anchorRef);
	const contextLabel = contextMeter(contextTokens, summarizeAt);
	const { unpriced = turns.length, subscription = 0 } = pricing ?? {};
	const providers = pricing?.subscriptionProviders ?? subscriptionLabels(turns.map((turn) => turn.model));
	const costLabel = planCostLabel(providers);
	if (contextLabel === null) return null;
	const newestFirst = turns.map((turn, i) => ({ turn, n: i + 1 })).reverse();

	return (
		<div data-testid="stats-bar" className="flex shrink-0">
			<button ref={anchorRef} type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="stats-summary" className={barWord(open)}>
				<PixelIcon name="chevron" className="rotate-90" />
				<span>
					<span data-testid="stats-context">{contextLabel}</span> lesson
				</span>
			</button>
			<MenuShell open={open} anchorRef={anchorRef} testid="stats-detail" role="dialog" label="Lesson stats" preferredSide="down" align="right" hang menuClass="lh-popup flex w-[340px] flex-col gap-1 px-4 py-3.5">
				<h3 className="text-[17px] text-ink">Lesson stats</h3>
				<p className="text-base text-ink-2">Summarizes here to keep the lesson small. Change it in Settings. {teacher}&apos;s own context is separate.</p>
				<StatRow label="Lesson size" value={contextLabel} />
				<StatRow label={subscription ? "Usage" : "Total cost"} value={costLabel} testId="stats-cost" />
				{unpriced > 0 && <StatRow label="Unpriced turns" value={String(unpriced)} />}
				<StatRow label="Turns" value={String(turns.length)} />
				{turns.length > 0 && (
					<ul className="flex max-h-56 flex-col overflow-y-auto">
						{newestFirst.map(({ turn, n }) => (
							<li key={`${turn.messageId}-${n}`}>
								<StatRow label={`#${n}, ${turn.steps.length} ${turn.steps.length === 1 ? "step" : "steps"}`} value={turnSize(turn)} />
							</li>
						))}
					</ul>
				)}
			</MenuShell>
		</div>
	);
}

function StatRow({ label, value, testId }: { label: string; value: string; testId?: string }) {
	return (
		<div className="flex items-center justify-between gap-2 py-[7px] text-[15px] text-ink">
			<span className="min-w-0 truncate">{label}</span>
			<span data-testid={testId} className="shrink-0 font-count text-ink-2">
				{value}
			</span>
		</div>
	);
}
