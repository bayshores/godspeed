import { useCallback, useRef, useState } from "react";
import { subscriptionLabels, subscriptionLabel, type SessionPricing, type TurnUsage } from "@/shared/core";
import { formatTokens, planCostLabel, prettyModel } from "@/frontend/components/usage-format";
import { usePresence } from "@/frontend/components/presence";
import { usePopoverDismiss } from "@/frontend/components/popover-dismiss";
import { Hint } from "@/frontend/components/ui/hint";

export function formatContextMeasurement(tokens: number | null, limit: number | null): string {
	const numerator = tokens === null ? "?" : formatTokens(tokens);
	return limit === null ? numerator : `${numerator} / ${formatTokens(limit)}`;
}

/**
 * The lesson's stats bar: the session's context window + usage as one
 * quiet row in the Your-turn panel's footer. Clicking it opens the
 * per-turn detail popover.
 *
 * Lessons run on the outside agent's own plan, so cost reads as the plan's
 * label; missing cost stays "–", never fake zero. Context is a separate
 * completed-conversation measurement, never a money-log/summarizer fold or
 * transcript estimate; its denominator is where the lesson gets summarized
 * (not the agent's own context, which the app can't see).
 * Successful compaction clears it to ?.
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
	const detail = usePresence(open);
	// Dropdown discipline: close on any pointerdown outside the bar or on Escape.
	const barRef = useRef<HTMLDivElement>(null);
	const close = useCallback(() => setOpen(false), []);
	usePopoverDismiss(barRef, open, close);
	const contextLabel = formatContextMeasurement(contextTokens, summarizeAt);
	const { unpriced = turns.length, subscription = 0 } = pricing ?? {};
	const providers = pricing?.subscriptionProviders ?? subscriptionLabels(turns.map((turn) => turn.model));
	const costLabel = planCostLabel(providers);

	return (
		<div
			data-testid="stats-bar"
			className="relative flex items-center justify-between gap-3 px-3 pt-2 text-xs text-muted-foreground"
		>
			<div ref={barRef} className="relative">
				{/* The popover and the outside-close ref anchor to this wrapper,
				    so the popover centers over the button, not the whole row.
				    No tooltip: the numbers describe themselves. */}
			<Hint label="Summarizes here to keep the lesson small. Change it in Settings. Your agent's own context is separate.">
				<button
					type="button"
					onClick={() => setOpen((o) => !o)}
					aria-expanded={open}
					data-testid="stats-summary"
					className="lh-press flex items-center gap-1.5 font-mono tabular-nums hover:text-foreground"
				>
					<span data-testid="stats-context">{contextLabel}</span>
					<span>lesson</span>
				</button>
			</Hint>
				{detail.mounted && (
					<div
						data-testid="stats-detail"
						data-side="up"
						data-state={detail.state}
						className="lh-pop absolute bottom-full left-1/2 z-40 mb-1.5 w-72 -translate-x-1/2 lh-popup p-3 text-xs"
					>
						<div className="mb-2 text-xs font-semibold text-muted-foreground">
							Session stats
						</div>
						<div className="flex flex-col gap-1 text-muted-foreground">
							<div className="flex justify-between gap-2">
								<span>Lesson size</span>
								<span className="font-mono tabular-nums text-card-foreground">
									{contextLabel}
								</span>
							</div>
							<div className="flex justify-between gap-2">
								<span>{subscription ? "Usage" : "Total cost"}</span>
								<span data-testid="stats-cost" className="font-mono tabular-nums text-card-foreground">{costLabel}</span>
							</div>
							{unpriced > 0 && (
								<div className="flex justify-between gap-2">
									<span>Unpriced turns</span>
									<span className="font-mono tabular-nums text-card-foreground">{unpriced}</span>
								</div>
							)}
						</div>
						{turns.length > 0 && (
							<>
								<div className="mb-1 mt-2.5 border-t pt-2 text-xs font-semibold text-muted-foreground">
									Turns
								</div>
								<ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
									{turns.map((turn, i) => (
										<li key={`${turn.messageId}-${i}`} className="flex items-center justify-between gap-2">
											<span className="truncate text-muted-foreground">
												#{i + 1} · {prettyModel(turn.model)}
											</span>
											<span className="flex shrink-0 items-center gap-2 font-mono tabular-nums text-card-foreground">
												<span className="text-muted-foreground">{turn.steps.length} steps</span>
												<span>{subscriptionLabel(turn.model) ?? "–"}</span>
											</span>
										</li>
									))}
								</ul>
							</>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
