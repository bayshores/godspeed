import { memo } from "react";
import { PlusIcon } from "lucide-react";
import { rampColor, type DeadlineProgress } from "@/core";
import { kindLabel } from "@/components/class-deadlines-model";
import { Countdown, useIsOverdue } from "@/components/countdown";
import { comingUpGroups, dueUnderLabel, itemsSummary, type OpenDeadline } from "@/components/deadlines-model";
import { DoneBox } from "@/components/done-box";
import { deadlineFilesText } from "@/components/graph/derive";
import { displayName } from "@/components/overview/overview-model";
import { percent } from "@/components/overview/runway-model";
import { CARD, CARD_TITLE } from "@/components/overview/styles";
import { cn } from "@/lib/utils";

/**
 * COMING UP (Home): every open deadline
 * from every class, grouped Overdue / Today / Tomorrow / each date / Later.
 * A row: the done box, the name and its kind, what it covers with a ready
 * bar (deadlines with files), the class, and the live countdown with the
 * due time under it. With no classes yet it offers New class.
 */
export const ComingUp = memo(function ComingUp({
	deadlines,
	progress,
	leaving,
	nowMs,
	fixedNow,
	hasClasses,
	onDone,
	onNewClass,
}: {
	deadlines: readonly OpenDeadline[];
	/** Each class's deadline progress by deadline id (covers, ready %). */
	progress: ReadonlyMap<string, DeadlineProgress>;
	leaving: ReadonlySet<string>;
	/** The window's clock to the minute (groups and the head). */
	nowMs: number;
	/** A fixed moment for the countdowns (tests). */
	fixedNow?: number;
	hasClasses: boolean;
	onDone: (d: OpenDeadline) => void;
	onNewClass: () => void;
}) {
	const groups = comingUpGroups(deadlines, nowMs);
	return (
		<section data-testid="coming-up" className={CARD}>
			<div className="flex w-full items-end justify-between gap-4">
				<h2 className={CARD_TITLE}>Coming up</h2>
				{deadlines.length > 0 && (
					<span data-testid="coming-up-summary" className="text-[13.5px] text-ink-2">
						{itemsSummary(deadlines, nowMs)}
					</span>
				)}
			</div>
			{groups.length === 0 ? (
				<>
					<p data-testid="coming-up-empty" className="text-[13.5px] leading-5 text-ink-2">
						{hasClasses
							? "No deadlines coming up. Your agent can add them from the syllabus, or you can use Add deadline."
							: "No classes yet. Add one, then add its deadlines in Edit class."}
					</p>
					{!hasClasses && (
						<button
							type="button"
							data-testid="coming-up-new-class"
							onClick={onNewClass}
							className="lh-press flex items-center gap-1.5 bg-tone px-3.5 py-2 text-sm font-bold text-ink hover:bg-tone-2"
						>
							<PlusIcon className="size-3.5 shrink-0" aria-hidden />
							New class
						</button>
					)}
				</>
			) : (
				<div className="flex w-full flex-col gap-5">
					{groups.map((g) => (
						<div key={g.key} data-testid={`coming-up-group-${g.key}`} className="flex w-full flex-col gap-2">
							<h3 className={cn("text-[13px] font-bold", g.overdue ? "text-ans-wrong" : "text-ink-2")}>{g.label}</h3>
							<ul className="flex w-full flex-col gap-0.5">
								{g.items.map((d) => (
									<ComingUpRow
										key={d.id}
										deadline={d}
										progress={progress.get(d.id) ?? null}
										leaving={leaving.has(d.id)}
										fixedNow={fixedNow}
										onDone={onDone}
									/>
								))}
							</ul>
						</div>
					))}
				</div>
			)}
		</section>
	);
});

function ComingUpRow({
	deadline: d,
	progress: p,
	leaving,
	fixedNow,
	onDone,
}: {
	deadline: OpenDeadline;
	progress: DeadlineProgress | null;
	leaving: boolean;
	fixedNow?: number;
	onDone: (d: OpenDeadline) => void;
}) {
	const overdue = useIsOverdue(d, fixedNow);
	const files = p ? deadlineFilesText(p.files.map((f) => ({ name: displayName(f.name) }))) : "";
	const ready = p?.ready ?? null;
	return (
		<li
			data-testid={`coming-up-row-${d.id}`}
			data-halley-target={`deadline:${d.id}`}
			data-leaving={leaving || undefined}
			className={cn(
				"flex w-full items-center gap-3.5 bg-tone px-3.5 py-[11px] transition-opacity duration-[var(--lh-dur)] ease-[var(--lh-ease-in)]",
				leaving && "pointer-events-none opacity-0",
			)}
		>
			<DoneBox size={16} overdue={overdue} name={d.name} disabled={leaving} onDone={() => onDone(d)} />
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex min-w-0 items-baseline gap-2">
					<span className="truncate text-[15.5px] leading-[22px] font-bold text-ink">{d.name}</span>
					<span className="shrink-0 text-[13.5px] text-ink-2">{kindLabel(d.kind).toLowerCase()}</span>
				</div>
				{files && (
					<div data-testid="coming-up-covers" className="flex min-w-0 items-center gap-2.5 text-[12.5px] leading-[18px]">
						<span className="min-w-0 truncate text-ink-2">covers {files}</span>
						{ready !== null && (
							<>
								<span className="flex h-[5px] w-[120px] shrink-0 bg-tone-2" aria-hidden>
									<span className="h-full" style={{ width: `${percent(ready)}%`, background: rampColor(ready) }} />
								</span>
								<span data-testid="coming-up-ready" className="shrink-0 font-mono font-bold tabular-nums" style={{ color: rampColor(ready) }}>
									{percent(ready)}% ready
								</span>
							</>
						)}
					</div>
				)}
			</div>
			<span data-testid="coming-up-class" className="shrink-0 bg-tone-2 px-2 py-0.5 text-[12.5px] leading-[18px] font-bold text-ink">
				{d.className}
			</span>
			<div className="flex w-[110px] shrink-0 flex-col items-end gap-0.5 text-right">
				<Countdown due={d} now={fixedNow} className="text-[14px] leading-5" clockClassName="text-[16px] leading-5" />
				<span className="truncate text-[12.5px] leading-[18px] text-ink-3">{dueUnderLabel(d, overdue)}</span>
			</div>
		</li>
	);
}
