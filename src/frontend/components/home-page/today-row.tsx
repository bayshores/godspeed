import type { ReactNode } from "react";
import Link from "next/link";
import type { ClassColor, DeadlineProgress } from "@/shared/core";
import { classColorVar } from "@/frontend/components/class-color";
import { dueAtMs } from "@/frontend/components/countdown-model";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { deadlineHref } from "@/frontend/components/overview/overview-model";
import { CountBlock } from "@/frontend/components/ui/count-block";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { Stamp } from "@/frontend/components/ui/stamp";
import { cn } from "@/frontend/lib/utils";
import { countLeft, laterLine, todayRow } from "./home-page-model";

/** The class's color; grey for a class that has gone. */
const blockColor = (color: ClassColor | undefined) => (color ? classColorVar(color) : "var(--border)");

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
	color: ClassColor | undefined;
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
							<Link href={deadlineHref(d.id)} prefetch={false} data-testid="today-open" title={words.title} className="hover:underline">
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

/** A deadline ticked done today: the stamp, its name dimmed, and Undo. */
export function DoneRow({ deadline: d, onUndo }: { deadline: OpenDeadline; onUndo: (d: OpenDeadline) => void }) {
	return (
		<li data-testid={`today-done-row-${d.id}`}>
			<Pane className="flex min-h-[104px] overflow-hidden">
				<span className="flex w-[116px] shrink-0 items-center justify-center self-stretch bg-[color-mix(in_srgb,var(--border)_50%,var(--card))]">
					<Stamp>Done</Stamp>
				</span>
				<div className="flex min-w-0 flex-1 items-center gap-4 px-6 py-4">
					<Words title={d.name} line={d.className} dim />
					<button type="button" data-testid="today-undo" onClick={() => onUndo(d)} className="lh-btn lh-btn-quiet h-[38px] shrink-0 text-[15px]">
						Undo
					</button>
				</div>
			</Pane>
		</li>
	);
}

/** A deadline under Later: the whole row opens its page. */
export function LaterRow({ deadline: d, progress, color, nowMs }: { deadline: OpenDeadline; progress: DeadlineProgress | undefined; color: ClassColor | undefined; nowMs: number }) {
	return (
		<li data-testid={`later-row-${d.id}`} data-halley-target={`deadline:${d.id}`}>
			<Pane className="overflow-hidden">
				<Link href={deadlineHref(d.id)} prefetch={false} className="flex min-h-[104px] transition-colors hover:bg-tone">
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
