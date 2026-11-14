import type { ProgressPayload } from "@/shared/core";
import { cn } from "@/frontend/lib/utils";
import { weekStrip } from "./week-model";

/**
 * This week, one quiet line under Today's title: a small square for each
 * day from Monday to Sunday, filled on a day with an answer in any space,
 * today's outlined in ink, and a sentence with the days and the answers.
 */
export function WeekStrip({ payloads, nowMs }: { payloads: readonly Pick<ProgressPayload, "lessons">[]; nowMs: number }) {
	const week = weekStrip(payloads, nowMs);
	return (
		<div data-testid="today-week" className="flex flex-wrap items-center gap-x-3 gap-y-1">
			<span role="img" aria-label={week.label} className="flex shrink-0 gap-[3px]">
				{week.days.map((d) => (
					<span
						key={d.day}
						data-testid={`today-week-${d.day}`}
						data-studied={d.studied || undefined}
						className={cn("size-3 border", d.studied ? "bg-highlight" : "", d.today ? "border-ink" : "border-ink-3")}
					/>
				))}
			</span>
			<p data-testid="today-week-line" className="text-[15px] text-ink-2">
				{week.sentence}
			</p>
		</div>
	);
}
