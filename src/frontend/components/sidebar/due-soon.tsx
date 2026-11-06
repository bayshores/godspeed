import { memo } from "react";
import { Countdown, useIsOverdue, useMinute } from "@/frontend/components/countdown";
import { DoneBox } from "@/frontend/components/done-box";
import { dueSoon, sidebarWhenLabel, type OpenDeadline } from "@/frontend/components/deadlines-model";
import { localDay } from "@/shared/core";
import { cn } from "@/frontend/lib/utils";
import { LABEL_TEXT } from "@/frontend/components/ui/label-text";

/**
 * DUE SOON (sidebar): the 4 most urgent
 * open deadlines from every class, overdue first. Each row is one line:
 * the done box (red once overdue), the name ("CSE 21 Final" when the rows
 * come from more than one class) and the live countdown; the class and
 * day ("CSE 21 · Thu 7:00 PM") show on hover. Hidden while there is
 * nothing open.
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
	const manyClasses = new Set(rows.map((d) => d.classId)).size > 1;
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
						withClass={manyClasses}
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
	withClass,
	fixedNow,
	onDone,
}: {
	deadline: OpenDeadline;
	leaving: boolean;
	/** The local day, "YYYY-MM-DD". */
	today: string;
	/** Name the class before the deadline (the rows span several classes). */
	withClass: boolean;
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
				"flex w-full items-center gap-2.5 px-2.5 py-1.5 transition-opacity duration-[var(--lh-dur)] ease-[var(--lh-ease-in)]",
				leaving && "pointer-events-none opacity-0",
			)}
		>
			<span className="flex shrink-0 items-center">
				<DoneBox size={13} overdue={overdue} name={d.name} disabled={leaving} onDone={() => onDone(d)} />
			</span>
			<span title={`${d.className} · ${sidebarWhenLabel(d, today)}`} className="min-w-0 flex-1 truncate text-[15px] text-ink">
				{withClass ? `${d.className} ${d.name}` : d.name}
			</span>
			<Countdown due={d} now={fixedNow} className="shrink-0 text-[15px]" />
		</li>
	);
}
