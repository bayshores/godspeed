import { Link } from "react-router";
import type { SpaceColor, DeadlineProgress } from "@/shared/core";
import { spaceColorVar } from "@/frontend/components/space-color";
import { dueAtMs } from "@/frontend/components/countdown-model";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { deadlineHref } from "@/frontend/components/overview/overview-model";
import { CountBlock } from "@/frontend/components/ui/count-block";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { countLeft, laterRow, todayRow } from "./home-page-model";
import { CHIP } from "./styles";

/** The space's color; grey for a space that has gone. */
export const blockColor = (color: SpaceColor | undefined) => (color ? spaceColorVar(color) : "var(--border)");

/** A row's small keycap. */
const SMALL_KEY = "lh-btn h-[30px] shrink-0 rounded-[8px] px-3 text-[13px]";

/**
 * A deadline under "Due this week": a small block with the time left,
 * what to do for it (opening the deadline's page) and when, "Mark done"
 * and its button (a small key: the card holds the main one).
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
	return (
		<li data-testid={`today-row-${d.id}`} data-teacher-target={`deadline:${d.id}`}>
			<div className="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 py-1">
				<CountBlock size="today" color={blockColor(color)} {...countLeft(dueAtMs(d), nowMs)} />
				<span className="flex min-w-0 flex-1 basis-[220px] flex-col gap-0.5">
					<Link to={deadlineHref(d.id)} data-testid="today-open" title={words.title} className="truncate text-[17px] leading-snug text-ink hover:underline">
						{words.title}
					</Link>
					<span title={words.line} className="truncate text-sm text-ink-2">
						{words.line}
					</span>
				</span>
				<span className="ml-auto flex shrink-0 items-center gap-2">
					<button type="button" data-testid="today-done" onClick={() => onDone(d)} className="lh-btn lh-btn-quiet h-[30px] text-[13px]">
						Mark done
					</button>
					<button type="button" data-testid="today-start" disabled={busy} onClick={() => onStart(d)} className={SMALL_KEY}>
						{words.button}
					</button>
				</span>
			</div>
		</li>
	);
}

/** A deadline ticked done today, the quietest row: "Done", its name dimmed, and Undo. */
export function DoneRow({ deadline: d, onUndo }: { deadline: OpenDeadline; onUndo: (d: OpenDeadline) => void }) {
	return (
		<li data-testid={`today-done-row-${d.id}`}>
			<div className="flex min-h-12 items-center gap-4">
				<span className="w-14 shrink-0 text-center text-sm text-ink-3">Done</span>
				<span className="flex min-w-0 flex-1 items-baseline gap-3">
					<span className="truncate text-[15px] text-ink-3 line-through">{d.name}</span>
					<span className="truncate text-sm text-ink-3">{d.spaceName}</span>
				</span>
				<button type="button" data-testid="today-undo" onClick={() => onUndo(d)} className="lh-btn lh-btn-quiet h-[30px] shrink-0 text-[13px]">
					Undo
				</button>
			</div>
		</li>
	);
}

/** A deadline under Later: its name, space and day, the days left, how
 *  far it is; the whole row opens its page. */
export function LaterRow({ deadline: d, progress, nowMs }: { deadline: OpenDeadline; progress: DeadlineProgress | undefined; nowMs: number }) {
	const words = laterRow(d, progress, nowMs);
	return (
		<li data-testid={`later-row-${d.id}`} data-teacher-target={`deadline:${d.id}`}>
			<Link to={deadlineHref(d.id)} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-1 py-2 text-[15px] transition-colors hover:bg-tone">
				<span title={d.name} className="min-w-0 truncate font-medium text-ink">
					{d.name}
				</span>
				<span title={words.when} className="min-w-0 flex-1 basis-[180px] truncate text-ink-2">
					{words.when}
				</span>
				<span className="flex shrink-0 items-center gap-3">
					<span className={`${CHIP} font-count`}>{words.left}</span>
					{words.ready && <span className="text-ink-2">{words.ready}</span>}
					<PixelIcon name="chevron" className="h-[11px] text-ink" />
				</span>
			</Link>
		</li>
	);
}
