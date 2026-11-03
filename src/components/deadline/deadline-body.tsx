import { memo, useState } from "react";
import Link from "next/link";
import { CheckIcon, FileTextIcon } from "lucide-react";
import { deadlineStudyLabel, rampColor, topicStatus, type DeadlineProgress, type PlanDay, type TopicProgress } from "@/core";
import { clockLabel, deadlineDateLabel, dueLabel, kindLabel } from "@/components/class-deadlines-model";
import { Countdown } from "@/components/countdown";
import { isOverdue } from "@/components/deadlines-model";
import { ActionBar } from "@/components/lesson/panel-parts";
import { ReadyRing } from "@/components/overview/ready-ring";
import { CARD, CARD_TITLE } from "@/components/overview/styles";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { materialSummary, rightLabel, shortDate, type ClassDay, type DayState, type Material } from "./deadline-model";

/**
 * ONE DEADLINE'S PAGE (pure view, the render-test seam): the name, when,
 * the countdown and the ready ring; its topics as a strip colored by how
 * you do; What's on it (its class days by week, and the ones before it
 * that it doesn't cover yet, to add or leave out) and the path to it (topics that need work, weakest first, one day at a time)
 * with the white Start bar on today.
 */

type TopicTally = Pick<TopicProgress, "id" | "right" | "answered">;

interface DeadlineBodyProps {
	deadline: DeadlineProgress;
	/** The class's topics, for each one's "2 of 5 right". */
	topics: readonly TopicTally[];
	/** Null while the class's files load. */
	material: Material | null;
	plan: readonly PlanDay[];
	nowMs: number;
	busy: boolean;
	/** Why the last Study start failed. */
	startError: string | null;
	onStart: () => void;
	onEditClass: () => void;
	/** Where the agent found what it covers. */
	source: string | undefined;
	teacherName: string;
	/** An Add or Leave out is being saved. */
	saving: boolean;
	onAsk: () => void;
	onAdd: (fileIds: string[]) => void;
	onLeaveOut: (fileIds: string[]) => void;
	/** Opens the cheat sheet (its setup the first time). */
	onCheatSheet: () => void;
}

const LEGEND: { key: keyof DeadlineProgress["counts"]; label: string; rate: number | null }[] = [
	{ key: "strong", label: "strong", rate: 0.9 },
	{ key: "shaky", label: "shaky", rate: 0.7 },
	{ key: "weak", label: "weak", rate: 0.3 },
	{ key: "untested", label: "not tested", rate: null },
];

export const DeadlineBody = memo(function DeadlineBody(props: DeadlineBodyProps) {
	const { deadline: d, nowMs } = props;
	const past = !d.done && isOverdue(d, nowMs);
	const tallies = new Map(props.topics.map((t) => [t.id, t]));
	const ready = d.files.length > 0 ? d.ready : null;
	return (
		<div data-testid="deadline-page" className="@container flex w-full flex-col gap-6 pb-8">
			<header className="flex items-start justify-between gap-8 px-[52px] pt-6">
				<div className="flex min-w-0 flex-col gap-2">
					<h1 data-testid="deadline-name" className="font-title text-[40px] leading-[48px] tracking-tight break-words text-ink">
						{d.name}
					</h1>
					<p data-testid="deadline-when" className="flex flex-wrap items-baseline gap-x-2 text-base leading-6 text-ink-2">
						<span>{kindLabel(d.kind)}</span>
						<span aria-hidden>·</span>
						<span>{dueLabel(d.date, d.time)}</span>
						<span aria-hidden>·</span>
						{d.done ? (
							<span className="font-bold text-ink">Done</span>
						) : past ? (
							<span className="text-ans-wrong">Was due</span>
						) : (
							<Countdown due={d} className="text-base leading-6 text-ink" clockClassName="text-[17px] leading-6" />
						)}
					</p>
				</div>
				<div className="flex shrink-0 items-start gap-6">
					<button
						type="button"
						data-testid="deadline-cheat-sheet"
						onClick={props.onCheatSheet}
						className="lh-press mt-1.5 flex items-center gap-2 px-3.5 py-2 text-sm font-bold text-ink outline outline-1 -outline-offset-1 outline-tone-2 hover:bg-tone"
					>
						<FileTextIcon className="size-4 text-ink-2" aria-hidden />
						Cheat sheet
					</button>
					<div data-testid="deadline-ring" className="flex flex-col items-center gap-1.5">
						<ReadyRing ready={ready} size={88} />
						<span className="text-[12.5px] text-ink-2">{ready === null ? "Not measured yet" : "ready"}</span>
					</div>
				</div>
			</header>

			{d.topics.length > 0 && <TopicStrip deadline={d} tallies={tallies} />}

			<div className="flex flex-col items-start gap-4 px-[52px] @4xl:flex-row">
				<div className="w-full min-w-0 flex-1">
					<CoversCard
						deadline={d}
						material={props.material}
						source={props.source}
						teacherName={props.teacherName}
						saving={props.saving}
						onEditClass={props.onEditClass}
						onAsk={props.onAsk}
						onAdd={props.onAdd}
						onLeaveOut={props.onLeaveOut}
					/>
				</div>
				<div className="w-full @4xl:w-[400px] @4xl:shrink-0">
					<PathCard {...props} past={past} tallies={tallies} />
				</div>
			</div>
		</div>
	);
});

function TopicStrip({ deadline: d, tallies }: { deadline: DeadlineProgress; tallies: ReadonlyMap<string, TopicTally> }) {
	return (
		<div className="flex flex-col gap-2.5 px-[52px]">
			<div data-testid="deadline-topics" className="flex h-2.5 w-full gap-[3px]">
				{d.topics.map((t) => (
					<Tip key={t.id} title={t.name} body={<span className="text-xs text-ink-2">{tallyText(tallies.get(t.id))}</span>}>
						{/* Focusable and named, so the tip isn't for the mouse only. */}
						<span
							data-testid="deadline-topic"
							role="img"
							tabIndex={0}
							aria-label={`${t.name}: ${tallyText(tallies.get(t.id))}`}
							className="h-full min-w-1 flex-1"
							style={{ background: rampColor(t.rate) }}
						/>
					</Tip>
				))}
			</div>
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-2">
				{LEGEND.filter((l) => d.counts[l.key] > 0).map((l) => (
					<span key={l.key} data-testid={`deadline-count-${l.key}`} className="flex items-center gap-1.5">
						<span className="size-2.5 shrink-0" style={{ background: rampColor(l.rate) }} aria-hidden />
						<span className="font-mono tabular-nums text-ink">{d.counts[l.key]}</span> {l.label}
					</span>
				))}
			</div>
		</div>
	);
}

const tallyText = (t: TopicTally | undefined) => (t ? rightLabel(t) : "not tested");

const BUTTON = "lh-press flex items-center gap-1.5 bg-tone px-3.5 py-2 text-sm font-bold text-ink hover:bg-tone-2 disabled:opacity-50";
const TEXT_BUTTON = "lh-press text-[13px] font-bold text-ink hover:underline disabled:opacity-50";
const WARN = "text-(--lh-ramp-2)";

function CoversCard({
	deadline: d,
	material: m,
	source,
	teacherName,
	saving,
	onEditClass,
	onAsk,
	onAdd,
	onLeaveOut,
}: {
	deadline: DeadlineProgress;
	material: Material | null;
	source: string | undefined;
	teacherName: string;
	saving: boolean;
	onEditClass: () => void;
	onAsk: () => void;
	onAdd: (fileIds: string[]) => void;
	onLeaveOut: (fileIds: string[]) => void;
}) {
	const [showLeftOut, setShowLeftOut] = useState(false);
	const empty = d.files.length === 0;
	const before = d.kind === "exam" ? "before the exam" : "before it's due";
	return (
		<section data-testid="deadline-material" className={CARD}>
			<div className="flex w-full items-center justify-between gap-4">
				<h2 className={CARD_TITLE}>What&apos;s on it</h2>
				<button type="button" data-testid="deadline-edit-files" onClick={onEditClass} className={cn(TEXT_BUTTON, "text-ink-2 hover:text-ink")}>
					Edit
				</button>
			</div>
			{!m ? (
				<div className="h-40 w-full bg-tone" aria-hidden />
			) : empty ? (
				<div data-testid="deadline-no-files" className="flex w-full flex-col items-start gap-3">
					<p className="text-[13.5px] leading-5 text-ink-2">
						Nothing is linked yet. {teacherName} can work it out from your files, like a practice exam or the syllabus.
					</p>
					<div className="flex flex-wrap gap-2">
						<button type="button" data-testid="deadline-ask" onClick={onAsk} className={BUTTON}>
							Ask {teacherName}
						</button>
						<button type="button" onClick={onEditClass} className={BUTTON}>
							Pick files
						</button>
					</div>
				</div>
			) : (
				<>
					<p data-testid="deadline-material-summary" className="-mt-2 w-full text-[13.5px] leading-5 text-ink-2">
						{materialSummary(m)}
						{source && (
							<>
								{". From "}
								<span data-testid="deadline-source" className="text-ink">
									{source}
								</span>
							</>
						)}
					</p>
					<div className="flex w-full flex-col">
						{m.weeks.map((w) => (
							<div key={w.number} data-testid="deadline-week" className="flex w-full gap-4 border-t border-tone-2 py-2.5">
								<span className="w-14 shrink-0 pt-px text-[12.5px] font-bold text-ink-3">Week {w.number}</span>
								<ul className="flex min-w-0 flex-1 flex-col gap-1.5">
									{w.days.map((day) => (
										<DayRow key={day.key} day={day} />
									))}
								</ul>
							</div>
						))}
						{m.undated.length > 0 && (
							<div data-testid="deadline-undated" className="flex w-full gap-4 border-t border-tone-2 py-2.5">
								<span className="w-14 shrink-0 pt-px text-[12.5px] font-bold text-ink-3">Other</span>
								<ul className="flex min-w-0 flex-1 flex-col gap-1.5">
									{m.undated.map((day) => (
										<DayRow key={day.key} day={day} />
									))}
								</ul>
							</div>
						)}
					</div>
					{m.notIncluded.length > 0 ? (
						<div data-testid="deadline-not-included" className="flex w-full flex-col gap-2 bg-[color-mix(in_oklab,var(--lh-ramp-2)_9%,transparent)] px-3.5 py-3">
							<div className="flex items-center justify-between gap-4">
								<p className={cn("text-[13.5px] font-bold", WARN)}>Not on it, but {before}</p>
								{m.notIncluded.length > 1 && (
									<button type="button" disabled={saving} onClick={() => onLeaveOut(m.notIncluded.flatMap((x) => x.fileIds))} className={cn(TEXT_BUTTON, "font-normal text-ink-2")}>
										Leave all out
									</button>
								)}
							</div>
							<ul className="flex flex-col gap-1.5">
								{m.notIncluded.map((day) => (
									<DayRow key={day.key} day={day} open>
										<button type="button" disabled={saving} onClick={() => onAdd(day.fileIds)} className={TEXT_BUTTON}>
											Add
										</button>
										<button type="button" disabled={saving} onClick={() => onLeaveOut(day.fileIds)} className={cn(TEXT_BUTTON, "font-normal text-ink-2")}>
											Leave out
										</button>
									</DayRow>
								))}
							</ul>
						</div>
					) : (
						<p data-testid="deadline-all-accounted" className="flex items-center gap-2 text-[13px] text-ink-2">
							<CheckIcon aria-hidden className="size-3.5 text-ans-right" />
							Every class day {before} is on it or left out.
						</p>
					)}
					{m.leftOut.length > 0 && (
						<div className="flex w-full flex-col gap-1.5">
							<button type="button" data-testid="deadline-left-out-toggle" aria-expanded={showLeftOut} onClick={() => setShowLeftOut((v) => !v)} className={cn(TEXT_BUTTON, "self-start font-normal text-ink-2")}>
								{m.leftOut.length} left out · {showLeftOut ? "Hide" : "Show"}
							</button>
							{showLeftOut && (
								<ul data-testid="deadline-left-out" className="flex flex-col gap-1.5">
									{m.leftOut.map((day) => (
										<DayRow key={day.key} day={day} open>
											<button type="button" disabled={saving} onClick={() => onAdd(day.fileIds)} className={TEXT_BUTTON}>
												Add back
											</button>
										</DayRow>
									))}
								</ul>
							)}
						</div>
					)}
					<div className="flex flex-wrap gap-2">
						<Link href="/class/files" data-testid="deadline-add-files" className={BUTTON}>
							Add files
						</Link>
						<button type="button" data-testid="deadline-ask" onClick={onAsk} className={BUTTON}>
							Ask {teacherName} to check
						</button>
					</div>
				</>
			)}
		</section>
	);
}

/** A state is a shape, not only a color: read is a check, being read a
 *  half box, couldn't be read a red diamond, course info an empty box; a
 *  day that isn't on it is an empty box in the warning color. */
function DayMark({ state, open }: { state: DayState; open: boolean }) {
	if (open) return <span aria-hidden className="size-3.5 shrink-0 shadow-[inset_0_0_0_1px_var(--lh-ramp-2)]" />;
	if (state === "ready")
		return (
			<span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center bg-ans-right">
				<CheckIcon className="size-2.5 text-background" strokeWidth={3.5} />
			</span>
		);
	if (state === "failed") return <span aria-hidden className="size-3.5 shrink-0 scale-[0.78] rotate-45 bg-ans-wrong" />;
	if (state === "reading") return <span aria-hidden className="size-3.5 shrink-0 bg-[linear-gradient(to_top,var(--lh-ink-3)_50%,transparent_50%)] shadow-[inset_0_0_0_1px_var(--lh-ink-3)]" />;
	return <span aria-hidden className="size-3.5 shrink-0 shadow-[inset_0_0_0_1px_var(--lh-ink-3)]" />;
}

const STATE_WORD: Record<DayState, string> = { ready: "read", reading: "being read", failed: "couldn't be read", info: "course info, no facts" };

function DayRow({ day, open = false, children }: { day: ClassDay; open?: boolean; children?: React.ReactNode }) {
	return (
		<li data-testid="deadline-day-row" data-state={open ? "open" : day.state} className="flex min-w-0 items-center gap-2.5">
			<DayMark state={day.state} open={open} />
			<span className="w-[52px] shrink-0 font-mono text-[12.5px] text-ink-2 tabular-nums">{day.date ? shortDate(day.date) : ""}</span>
			<Tip title={day.title} body={<span className="text-xs text-ink-2">{`${day.names.join(", ")} · ${STATE_WORD[day.state]}`}</span>}>
				<span tabIndex={0} className="max-w-[60%] shrink-0 truncate text-[14px] text-ink">
					{day.title}
				</span>
			</Tip>
			<span className={cn("min-w-0 flex-1 truncate text-[12.5px]", day.state === "failed" ? "text-ans-wrong" : "text-ink-3")}>
				{day.state === "failed" ? "couldn't be read" : day.parts.join(" · ")}
			</span>
			{children && <span className="ml-auto flex shrink-0 items-center gap-3 pl-2">{children}</span>}
		</li>
	);
}

function PathCard({
	deadline: d,
	plan,
	material,
	busy,
	startError,
	onStart,
	past,
	tallies,
}: DeadlineBodyProps & { past: boolean; tallies: ReadonlyMap<string, TopicTally> }) {
	const allStrong = plan.length === 0 && d.topics.length > 0 && d.topics.every((t) => topicStatus(t.rate) === "strong");
	const canStart = !d.done && !past && (plan.length > 0 || allStrong);
	return (
		<section data-testid="deadline-path" className={cn(CARD, canStart && "pb-0")}>
			<h2 className={CARD_TITLE}>{d.done || past ? "Path" : `Path to ${deadlineDateLabel(d.date)}`}</h2>
			{!d.done && !past && (
				<p data-testid="deadline-path-note" className="text-[13.5px] leading-5 text-ink-2">
					{pathNote(d, plan.length > 0, allStrong, material)}
				</p>
			)}
			{plan.length > 0 && !d.done && !past && (
				<ol className="flex w-full flex-col">
					{plan.map((day, i) => (
						<li key={day.day} data-testid="deadline-day" className="flex w-full gap-4 border-t border-tone-2 py-2.5 first:border-t-0">
							<span className={cn("w-[84px] shrink-0 text-[13.5px]", i === 0 ? "font-bold text-ink" : "text-ink-2")}>
								{i === 0 ? "Today" : deadlineDateLabel(day.day)}
							</span>
							<ul className="flex min-w-0 flex-1 flex-col gap-1">
								{day.topics.map((t) => (
									<li key={t.id} className="flex min-w-0 items-center gap-2 text-[13.5px]">
										<span className="size-2.5 shrink-0" style={{ background: rampColor(t.rate) }} aria-hidden />
										<span title={t.name} className="min-w-0 flex-1 truncate text-ink">{t.name}</span>
										<span className="shrink-0 text-[12.5px] text-ink-3">{tallyText(tallies.get(t.id))}</span>
									</li>
								))}
							</ul>
						</li>
					))}
					<li data-testid="deadline-day-due" className="flex w-full gap-4 border-t border-tone-2 py-2.5">
						<span className="w-[84px] shrink-0 text-[13.5px] text-ink-2">{deadlineDateLabel(d.date)}</span>
						<span className="text-[13.5px] font-bold text-ink">{d.time ? `${d.name} · ${clockLabel(d.time)}` : d.name}</span>
					</li>
				</ol>
			)}
			{startError && (
				<p role="alert" data-testid="deadline-start-error" className="text-[13px] text-ans-wrong">
					{startError}
				</p>
			)}
			{canStart && (
				// Flush with the card's edges and foot, like the lesson panel's bar.
				<div className="-mx-[22px] w-[calc(100%+44px)]">
					<ActionBar testId="deadline-start" label={deadlineStudyLabel(d.continueStudy)} onClick={onStart} disabled={busy} />
				</div>
			)}
		</section>
	);
}

/** The Path card's note while the deadline is ahead (the header already
 *  says done or past). */
function pathNote(d: DeadlineProgress, hasPlan: boolean, allStrong: boolean, m: Material | null): string {
	if (hasPlan) return d.daysUntil === 0 ? "Due today, so everything that needs work is on today." : "Topics that need work, weakest first.";
	if (allStrong) return "Every topic is strong. Study them to keep it that way.";
	if (d.files.length === 0) return "A plan shows up once it knows what's on it.";
	if (m && m.reading > 0) return "Its files are still being read. The plan shows up once their facts are built.";
	return "Its files have no facts yet, so there is nothing to plan. Course info files never make facts.";
}
