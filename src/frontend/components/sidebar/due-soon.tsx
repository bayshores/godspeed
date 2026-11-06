import { memo } from "react";
import { Countdown, useIsOverdue, useMinute } from "@/frontend/components/countdown";
import { DoneBox } from "@/frontend/components/done-box";
import { dueSoon, sidebarWhenLabel, type OpenDeadline } from "@/frontend/components/deadlines-model";
import { localDay } from "@/shared/core";
import { cn } from "@/frontend/lib/utils";
import { LABEL_TEXT } from "@/frontend/components/ui/label-text";

/**
 * DUE SOON (sidebar): the 4 most urgent
 * open deadlines from every class, overdue first. Each row: the done box
 * (red once overdue), the name with "CSE 21 · 5:00 PM" (or "Thu 7:00 PM", "Thu Nov 12") under it, and the
 * live countdown. Hidden while there is nothing open.
 */
export const DueSoon = memo(function DueSoon({
	deadlines,
	leaving,
	fixedNow,
	onDone,
}: {
	/** Open deadlines (null while loading). */
	deadlines: readonly OpenDeadline[] | null;
	leaving: ReadonlySet<string>;
	/** A fixed moment for the countdowns (tests). */
	fixedNow?: number;
	onDone: (d: OpenDeadline) => void;
}) {
	// The minute clock keeps the when lines right past midnight.
	const minute = useMinute();
	const rows = dueSoon(deadlines ?? []);
	if (rows.length === 0) return null;
	const today = localDay(fixedNow ?? minute ?? Date.now());
	return (
		<section data-testid="due-soon" aria-label="Due soon" className="flex w-full flex-col">
			<span className={cn("px-2.5 pt-1", LABEL_TEXT)}>Due soon</span>
			<ul className="mt-2 flex w-full flex-col gap-px">
				{rows.map((d) => (
					<DueSoonRow
						key={d.id}
						deadline={d}
						leaving={leaving.has(d.id)}
						today={today}
						fixedNow={fixedNow}
						onDone={onDone}
					/>
				))}
			</ul>
		</section>
	);
});

function DueSoonRow({
	deadline: d,
	leaving,
	today,
	fixedNow,
	onDone,
}: {
	deadline: OpenDeadline;
	leaving: boolean;
	/** The local day, "YYYY-MM-DD". */
	today: string;
	fixedNow?: number;
	onDone: (d: OpenDeadline) => void;
}) {
	const overdue = useIsOverdue(d, fixedNow);
	return (
		<li
			data-testid={`due-soon-row-${d.id}`}
			data-halley-target={`deadline:${d.id}`}
			data-leaving={leaving || undefined}
			className={cn(
				"flex w-full items-start gap-2.5 px-2.5 py-1.5 transition-opacity duration-[var(--lh-dur)] ease-[var(--lh-ease-in)]",
				leaving && "pointer-events-none opacity-0",
			)}
		>
			<span className="flex h-5 shrink-0 items-center">
				<DoneBox size={13} overdue={overdue} name={d.name} disabled={leaving} onDone={() => onDone(d)} />
			</span>
			<span className="flex min-w-0 flex-1 flex-col">
				<span title={d.name} className="truncate text-[14px] leading-5 text-ink">{d.name}</span>
				<span title={d.className} className="truncate text-[12px] leading-4 text-ink-2">
					{d.className} · {sidebarWhenLabel(d, today)}
				</span>
			</span>
			<span className="flex h-5 shrink-0 items-center">
				<Countdown due={d} now={fixedNow} className="text-[12.5px]" />
			</span>
		</li>
	);
}
