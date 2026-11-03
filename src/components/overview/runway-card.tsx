import { memo, type CSSProperties } from "react";
import Link from "next/link";
import { ArrowRightIcon, PlusIcon } from "lucide-react";
import { rampColor, type DeadlineProgress } from "@/core";
import { deadlineDateLabel } from "@/components/class-deadlines-model";
import { Tip } from "@/components/ui/tooltip";
import { ReadyRing } from "./ready-ring";
import { deadlineHref, gapLabel, joinAnd, mostNeeded, percent, ringMeta, ringTitle, runwayStops, stopMeta, upcomingDeadlines, type MostNeeded } from "./runway-model";
import { CARD, CARD_TITLE } from "./styles";

/**
 * "READY FOR WHAT'S DUE" (Class Overview): a runway from Today through
 * the next 5 open deadlines. Every stop
 * is a 120px column on one strict grid; deadline stops are 88px rings of
 * their ready % (empty with "–" when nothing is covered). A 2px line joins
 * the stops through their centers, stopping 10px short of each, with the
 * days between them above it. Hover a ring: its topics, weakest first;
 * click: the deadline's page. Below: "Most needed" with Learn this. With
 * no deadlines: one line and Add deadline.
 */

/** Columns on the runway: Today plus RUNWAY_STOPS. */
const COLUMNS = 6;
const RING = 88;
const DOT = 12;
/** The line stops this far from each ring or dot. */
const LINE_GAP = 10;

export const RunwayCard = memo(function RunwayCard({
	deadlines,
	today,
	nowMs,
	busy,
	startError,
	onLearn,
	onAddDeadline,
}: {
	deadlines: readonly DeadlineProgress[];
	/** The learner's day, YYYY-MM-DD. */
	today: string;
	nowMs: number;
	/** A lesson is starting (Learn this). */
	busy: boolean;
	/** Why the last lesson didn't start. */
	startError: string | null;
	onLearn: (topicId: string) => void;
	/** Opens Edit class with a new deadline row. */
	onAddDeadline?: () => void;
}) {
	const upcoming = upcomingDeadlines(deadlines, nowMs);
	const { stops, later } = runwayStops(upcoming);
	const needed = mostNeeded(upcoming);
	// Each stop's half-width on the line (the Today dot, then the rings).
	const radii = [DOT / 2, ...stops.map(() => RING / 2)];
	const dates = [today, ...stops.map((d) => d.date)];
	return (
		<section data-testid="overview-runway" className={CARD}>
			<h2 className={CARD_TITLE}>Ready for what&apos;s due</h2>

			<div className="w-full overflow-x-auto">
				<div
					data-testid="runway"
					className="grid w-full pt-6 pb-1"
					style={{ gridTemplateColumns: `repeat(${COLUMNS}, minmax(120px, 1fr))` }}
				>
					<Stop
						testid="runway-today"
						mark={<span className="block rounded-full bg-ink" style={{ width: DOT, height: DOT }} aria-hidden />}
						name="Today"
						meta={deadlineDateLabel(today)}
						segment={stops.length > 0 ? { from: radii[0]!, to: radii[1]!, label: gapLabel(dates[0]!, dates[1]!) } : null}
					/>
					{stops.map((d, i) => (
						<Stop
							key={d.id}
							testid={`runway-stop-${d.id}`}
							halleyTarget={`deadline:${d.id}`}
							mark={<Ring deadline={d} />}
							name={d.name}
							meta={stopMeta(d)}
							segment={i + 1 < stops.length ? { from: radii[i + 1]!, to: radii[i + 2]!, label: gapLabel(dates[i + 1]!, dates[i + 2]!) } : null}
						/>
					))}
					{later > 0 && (
						<div className="flex flex-col items-center">
							<div className="flex items-center justify-center" style={{ height: RING }}>
								<Link href="/" data-testid="runway-later" className="lh-press text-[14.5px] font-bold text-ink-2 hover:text-ink">
									+{later} later
								</Link>
							</div>
						</div>
					)}
					{stops.length === 0 && (
						<div className="flex items-center gap-4 px-4" style={{ gridColumn: `2 / span ${COLUMNS - 1}`, height: RING }}>
							<p data-testid="runway-empty" className="text-[13.5px] text-ink-2">
								No deadlines yet. Your agent can add them from the syllabus.
							</p>
							{onAddDeadline && (
								<button
									type="button"
									data-testid="runway-add-deadline"
									onClick={onAddDeadline}
									className="lh-press flex shrink-0 items-center gap-1.5 bg-tone px-3.5 py-2 text-sm font-bold text-ink hover:bg-tone-2"
								>
									<PlusIcon className="size-3.5 shrink-0" aria-hidden />
									Add deadline
								</button>
							)}
						</div>
					)}
				</div>
			</div>

			{needed && <MostNeededRow needed={needed} busy={busy} onLearn={onLearn} />}
			{startError && (
				<p role="alert" data-testid="runway-start-error" className="text-[13px] text-ans-wrong">
					{startError}
				</p>
			)}
		</section>
	);
});

/** One 120px column: the mark centered on the line, then the name and
 *  meta on shared baselines. `segment` draws the line to the next stop. */
function Stop({
	testid,
	halleyTarget,
	mark,
	name,
	meta,
	segment,
}: {
	testid: string;
	halleyTarget?: string;
	mark: React.ReactNode;
	name: string;
	meta: string;
	segment: { from: number; to: number; label: string } | null;
}) {
	return (
		<div data-testid={testid} data-halley-target={halleyTarget} className="relative flex min-w-0 flex-col items-center">
			{segment && <Segment {...segment} />}
			<div className="flex items-center justify-center" style={{ height: RING }}>
				{mark}
			</div>
			<div className="mt-3 flex w-[120px] flex-col items-center gap-0.5 text-center">
				<span title={name} className="w-full truncate text-[14.5px] leading-5 font-bold text-ink">{name}</span>
				<span className="w-full truncate text-[12.5px] leading-[18px] text-ink-2">{meta}</span>
			</div>
		</div>
	);
}

/** The line from this stop's center to the next column's center, short of
 *  both marks by LINE_GAP, with the days between them above it. */
function Segment({ from, to, label }: { from: number; to: number; label: string }) {
	const style: CSSProperties = {
		top: RING / 2 - 1,
		left: `calc(50% + ${from + LINE_GAP}px)`,
		right: `calc(-50% + ${to + LINE_GAP}px)`,
	};
	return (
		<div data-testid="runway-line" className="absolute h-0.5 bg-tone-2" style={style} aria-hidden>
			{label && (
				<span className="absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap text-[12.5px] leading-[18px] text-ink-3">{label}</span>
			)}
		</div>
	);
}

function Ring({ deadline: d }: { deadline: DeadlineProgress }) {
	return (
		<Tip side="bottom" title={ringTitle(d)} body={<RingTipBody deadline={d} />}>
			<Link
				href={deadlineHref(d.id)}
				data-testid={`runway-ring-${d.id}`}
				aria-label={ringTitle(d)}
				className="group flex items-center justify-center outline-none"
			>
				<ReadyRing ready={d.files.length > 0 ? d.ready : null} size={RING} hover />
			</Link>
		</Tip>
	);
}

function RingTipBody({ deadline: d }: { deadline: DeadlineProgress }) {
	return (
		<>
			<span className="text-xs text-ink-2">{ringMeta(d)}</span>
			{d.topics.length > 0 && (
				<span className="flex flex-col gap-1">
					{d.topics.map((t) => (
						<span key={t.id} className="flex items-center gap-2">
							<span className="size-2.5 shrink-0" style={{ background: rampColor(t.rate) }} aria-hidden />
							<span title={t.name} className="min-w-0 flex-1 truncate text-ink">{t.name}</span>
							<span className="shrink-0 font-mono tabular-nums">{t.rate === null ? "not tested" : `${percent(t.rate)}% right`}</span>
						</span>
					))}
				</span>
			)}
		</>
	);
}

function MostNeededRow({ needed, busy, onLearn }: { needed: MostNeeded; busy: boolean; onLearn: (topicId: string) => void }) {
	return (
		<div data-testid="runway-most-needed" className="flex w-full items-center gap-3 border-t border-tone-2 pt-3">
			<span className="shrink-0 text-[13.5px] font-bold text-ink-2">Most needed</span>
			<span title={needed.name} className="min-w-0 shrink truncate text-[15.5px] font-bold text-ink">{needed.name}</span>
			<span className="min-w-0 flex-1 truncate text-[13.5px] text-ink-3">on {joinAnd(needed.deadlines)}</span>
			<button
				type="button"
				data-testid="runway-learn-this"
				disabled={busy}
				onClick={() => onLearn(needed.topicId)}
				className="lh-press flex shrink-0 items-center gap-1.5 bg-ink px-3.5 py-2 text-sm font-extrabold text-background hover:bg-ink-max disabled:opacity-60"
			>
				Learn this
				<ArrowRightIcon className="size-3.5" aria-hidden />
			</button>
		</div>
	);
}
