import type { ProgressPayload } from "@/shared/core";
import { cn } from "@/frontend/lib/utils";
import { SECTION_TITLE } from "./styles";
import { weekStrip } from "./week-model";

/**
 * "This week": a square for each day from Monday to Sunday, filled on a
 * day with an answer in any space, today's letter marked, and one sentence
 * with the days and the answers.
 */
export function WeekStrip({ payloads, nowMs }: { payloads: readonly Pick<ProgressPayload, "lessons">[]; nowMs: number }) {
	const week = weekStrip(payloads, nowMs);
	return (
		<section data-testid="today-week" className="flex flex-col gap-3">
			<h2 className={SECTION_TITLE}>This week</h2>
			<div className="flex flex-wrap items-center gap-x-7 gap-y-3">
				<div role="img" aria-label={week.label} className="flex shrink-0 gap-1.5">
					{week.days.map((d) => (
						<span key={d.day} className="flex flex-col items-center gap-1">
							<span data-testid={`today-week-${d.day}`} data-studied={d.studied || undefined} className={cn("size-8 border-2", d.studied ? "border-ink bg-ink" : "border-line bg-panel")} />
							<span className={cn("w-6 text-center text-sm", d.today ? "bg-highlight text-ink" : "text-ink-2")}>{d.name[0]}</span>
						</span>
					))}
				</div>
				<p data-testid="today-week-line" className="min-w-0 flex-1 basis-[260px] text-lg text-ink">
					{week.sentence}
				</p>
			</div>
		</section>
	);
}
