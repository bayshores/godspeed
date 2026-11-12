import type { ReactNode } from "react";
import { Link } from "react-router";
import type { SpaceColor, DeadlineProgress } from "@/shared/core";
import { spaceColorVar } from "@/frontend/components/space-color";
import { dueAtMs } from "@/frontend/components/countdown-model";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { deadlineHref } from "@/frontend/components/overview/overview-model";
import { CountBlock } from "@/frontend/components/ui/count-block";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { Stamp } from "@/frontend/components/ui/stamp";
import { cn } from "@/frontend/lib/utils";
import { prepCount } from "@/frontend/components/prep/prep-model";
import { countLeft, laterLine, longDay, todayRow, type PrepDay } from "./home-page-model";

/** The space's color; grey for a space that has gone. */
const blockColor = (color: SpaceColor | undefined) => (color ? spaceColorVar(color) : "var(--border)");

/** A row's two lines of words. */
function Words({ title, line, dim }: { title: ReactNode; line: string; dim?: boolean }) {
	return (
		<span className="flex min-w-0 flex-1 basis-[220px] flex-col gap-1">
			<span className={cn("truncate text-[23px] leading-tight", dim ? "text-ink-3" : "text-ink")}>{title}</span>
			<span title={line} className="truncate text-base text-ink-2">
				{line}
			</span>
		</span>
	);
}

/**
 * A deadline under Today: its count block, what to do for it, "Mark done"
 * and the one main button. The title opens the deadline's page.
 */
export function TodayRow({
	deadline: d,
	progress,
	color,
	nowMs,
	busy,
	onStart,
	onDone,
}: {
	deadline: OpenDeadline;
	progress: DeadlineProgress | undefined;
	color: SpaceColor | undefined;
	nowMs: number;
	/** A lesson is starting. */
	busy: boolean;
	onStart: (d: OpenDeadline) => void;
	onDone: (d: OpenDeadline) => void;
}) {
	const words = todayRow(d, progress, nowMs);
	const work = words.button === "Work on it";
	return (
		<li data-testid={`today-row-${d.id}`} data-halley-target={`deadline:${d.id}`}>
			<Pane className="flex min-h-[104px] overflow-hidden">
				<CountBlock color={blockColor(color)} {...countLeft(dueAtMs(d), nowMs)} />
				<div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-3 px-6 py-4">
					<Words
						title={
							<Link to={deadlineHref(d.id)} data-testid="today-open" title={words.title} className="hover:underline">
								{words.title}
							</Link>
						}
						line={words.line}
					/>
					<span className="flex shrink-0 items-center gap-2">
						<button type="button" data-testid="today-done" onClick={() => onDone(d)} className="lh-btn lh-btn-quiet h-[38px] text-[15px]">
							Mark done
						</button>
						<button
							type="button"
							data-testid="today-start"
							disabled={busy}
							onClick={() => onStart(d)}
							className={cn("lh-btn", work ? "h-[38px] text-[15px]" : "lh-btn-main h-[53px] gap-2.5 px-[22px] text-[17px]")}
						>
							{!work && <PixelIcon name="play" />}
							{words.button}
						</button>
					</span>
				</div>
			</Pane>
		</li>
	);
}

/** A prep's count block: "6" over "days", "today" on the day. */
const prepBlock = (prep: PrepDay, nowMs: number) => prepCount(prep.date, nowMs) ?? { count: "today", unit: "" };

/**
 * A prep under Today: the days left, its name (which opens its sheet), its
 * day, and Study, which starts on the topics that most need work.
 */
export function PrepTodayRow({ prep, nowMs, busy, onOpen, onStudy }: { prep: PrepDay; nowMs: number; busy: boolean; onOpen: (prep: PrepDay) => void; onStudy: (prep: PrepDay) => void }) {
	return (
		<li data-testid={`today-prep-${prep.spaceId}`}>
			<Pane className="flex min-h-[104px] overflow-hidden">
				<CountBlock color={spaceColorVar(prep.color)} {...prepBlock(prep, nowMs)} />
				<div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-3 px-6 py-4">
					<Words
						title={
							<Link to="/space" data-testid="today-prep-open" title={prep.name} onClick={() => onOpen(prep)} className="hover:underline">
								{prep.name}
							</Link>
						}
						line={`It is on ${longDay(prep.date)}`}
					/>
					<button type="button" data-testid="today-prep-study" disabled={busy} onClick={() => onStudy(prep)} className="lh-btn lh-btn-main h-[53px] shrink-0 gap-2.5 px-[22px] text-[17px]">
						<PixelIcon name="play" />
						Study
					</button>
				</div>
			</Pane>
		</li>
	);
}

/** A prep under Later: the whole row opens its sheet. */
export function PrepLaterRow({ prep, nowMs, onOpen }: { prep: PrepDay; nowMs: number; onOpen: (prep: PrepDay) => void }) {
	return (
		<li data-testid={`later-prep-${prep.spaceId}`}>
			<Pane className="overflow-hidden">
				<Link to="/space" onClick={() => onOpen(prep)} className="flex min-h-[104px] transition-colors hover:bg-tone">
					<CountBlock pale color={spaceColorVar(prep.color)} {...prepBlock(prep, nowMs)} />
					<span className="flex min-w-0 flex-1 items-center gap-4 px-6 py-4">
						<Words title={prep.name} line={`It is on ${longDay(prep.date)}`} />
						<PixelIcon name="chevron" className="h-[15px] text-ink" />
					</span>
				</Link>
			</Pane>
		</li>
	);
}

/** A deadline ticked done today: the stamp, its name dimmed, and Undo. */
export function DoneRow({ deadline: d, onUndo }: { deadline: OpenDeadline; onUndo: (d: OpenDeadline) => void }) {
	return (
		<li data-testid={`today-done-row-${d.id}`}>
			<Pane className="flex min-h-[104px] overflow-hidden">
				<span className="flex w-[116px] shrink-0 items-center justify-center self-stretch bg-[color-mix(in_srgb,var(--border)_50%,var(--card))]">
					<Stamp>Done</Stamp>
				</span>
				<div className="flex min-w-0 flex-1 items-center gap-4 px-6 py-4">
					<Words title={d.name} line={d.spaceName} dim />
					<button type="button" data-testid="today-undo" onClick={() => onUndo(d)} className="lh-btn lh-btn-quiet h-[38px] shrink-0 text-[15px]">
						Undo
					</button>
				</div>
			</Pane>
		</li>
	);
}

/** A deadline under Later: the whole row opens its page. */
export function LaterRow({ deadline: d, progress, color, nowMs }: { deadline: OpenDeadline; progress: DeadlineProgress | undefined; color: SpaceColor | undefined; nowMs: number }) {
	return (
		<li data-testid={`later-row-${d.id}`} data-halley-target={`deadline:${d.id}`}>
			<Pane className="overflow-hidden">
				<Link to={deadlineHref(d.id)} className="flex min-h-[104px] transition-colors hover:bg-tone">
					<CountBlock pale color={blockColor(color)} {...countLeft(dueAtMs(d), nowMs)} />
					<span className="flex min-w-0 flex-1 items-center gap-4 px-6 py-4">
						<Words title={d.name} line={laterLine(d, progress)} />
						<PixelIcon name="chevron" className="h-[15px] text-ink" />
					</span>
				</Link>
			</Pane>
		</li>
	);
}
