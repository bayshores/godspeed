import { memo } from "react";
import Link from "next/link";
import { rampColor, topicStatus, type DeadlineProgress, type PlanDay, type TopicProgress } from "@/core";
import { clockLabel, deadlineDateLabel, dueLabel, kindLabel } from "@/components/class-deadlines-model";
import { Countdown } from "@/components/countdown";
import { isOverdue } from "@/components/deadlines-model";
import { ActionBar } from "@/components/lesson/panel-parts";
import { ReadyRing } from "@/components/overview/ready-ring";
import { CARD, CARD_TITLE } from "@/components/overview/styles";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { materialSummary, rightLabel, type Material, type MaterialSeries, type Slot } from "./deadline-model";

/**
 * ONE DEADLINE'S PAGE (pure view, the render-test seam): the name, when,
 * the countdown and the ready ring; its topics as a strip colored by how
 * you do; Material (does godspeed have everything it covers?) and the
 * path to it (topics that need work, weakest first, one day at a time)
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
	/** Why the last practice didn't start. */
	startError: string | null;
	onStart: () => void;
	onEditClass: () => void;
	onCheckSyllabus: () => void;
}

const LEGEND: { key: keyof DeadlineProgress["counts"]; label: string; rate: number | null }[] = [
	{ key: "strong", label: "strong", rate: 0.9 },
	{ key: "shaky", label: "shaky", rate: 0.7 },
	{ key: "weak", label: "weak", rate: 0.3 },
	{ key: "untested", label: "not tried yet", rate: null },
];

export const DeadlineBody = memo(function DeadlineBody(props: DeadlineBodyProps) {
	const { deadline: d, nowMs } = props;
	const past = !d.done && isOverdue(d, nowMs);
	const tallies = new Map(props.topics.map((t) => [t.id, t]));
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
				<div data-testid="deadline-ring" className="flex shrink-0 flex-col items-center gap-1.5">
					<ReadyRing ready={d.files.length > 0 ? d.ready : null} size={88} />
					<span className="text-[12.5px] text-ink-2">ready</span>
				</div>
			</header>

			{d.topics.length > 0 && <TopicStrip deadline={d} tallies={tallies} />}

			<div className="flex flex-col items-start gap-4 px-[52px] @4xl:flex-row">
				<div className="w-full min-w-0 flex-1">
					<MaterialCard material={props.material} coversFiles={d.files.length > 0} onEditClass={props.onEditClass} onCheckSyllabus={props.onCheckSyllabus} />
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

const tallyText = (t: TopicTally | undefined) => (t ? rightLabel(t) : "not tried yet");

const BUTTON = "lh-press flex items-center gap-1.5 bg-tone px-3.5 py-2 text-sm font-bold text-ink hover:bg-tone-2";

function MaterialCard({
	material: m,
	coversFiles,
	onEditClass,
	onCheckSyllabus,
}: {
	material: Material | null;
	coversFiles: boolean;
	onEditClass: () => void;
	onCheckSyllabus: () => void;
}) {
	return (
		<section data-testid="deadline-material" className={CARD}>
			<div className="flex w-full flex-col gap-1">
				<h2 className={CARD_TITLE}>Material</h2>
				{m && (
					<p data-testid="deadline-material-summary" className="text-[13.5px] text-ink-2">
						{materialSummary(m)}
					</p>
				)}
			</div>
			{!m ? (
				<div className="h-40 w-full bg-tone" aria-hidden />
			) : (
				<>
					{!coversFiles && (
						<p data-testid="deadline-no-files" className="text-[13.5px] leading-5 text-ink-2">
							This deadline doesn&apos;t name the files it covers yet, so here is all your study material.{" "}
							<button type="button" onClick={onEditClass} className="lh-press font-bold text-ink underline underline-offset-2">
								Pick its files in Edit class
							</button>
						</p>
					)}
					{m.series.length > 0 && (
						<div className="flex w-full flex-col gap-2.5">
							{m.series.map((s) => (
								<SeriesRow key={s.key} series={s} />
							))}
						</div>
					)}
					{m.loose.length > 0 && (
						<ul data-testid="deadline-loose" className="flex w-full flex-col gap-1 text-[13.5px]">
							{m.loose.map((f) => (
								<li key={f.id} className="flex min-w-0 items-center gap-3">
									<span className="min-w-0 flex-1 truncate text-ink">{f.name}</span>
									<span className={cn("shrink-0 text-[12.5px]", f.state === "failed" ? "text-ans-wrong" : "text-ink-3")}>{LOOSE_STATE[f.state]}</span>
								</li>
							))}
						</ul>
					)}
					<div className="flex flex-wrap gap-2">
						<Link href="/class/files" data-testid="deadline-add-files" className={BUTTON}>
							Add files
						</Link>
						<button type="button" data-testid="deadline-check-syllabus" onClick={onCheckSyllabus} className={BUTTON}>
							Check with the syllabus
						</button>
					</div>
					<div className="flex w-full flex-col gap-1 border-t border-tone-2 pt-3 text-[12.5px] leading-[18px] text-ink-3">
						{m.studyFiles > 0 && (
							<p data-testid="deadline-read">
								{m.reading + m.failed === 0
									? `All ${m.studyFiles} study ${m.studyFiles === 1 ? "file" : "files"} read, ${m.facts} facts.`
									: `${m.studyFiles - m.reading - m.failed} of ${m.studyFiles} study files read, ${m.facts} facts so far.`}
							</p>
						)}
						{m.infoFiles > 0 && (
							<p data-testid="deadline-info-note">
								{m.infoFiles} course info {m.infoFiles === 1 ? "file" : "files"}: the teacher can read {m.infoFiles === 1 ? "it" : "them"}, but {m.infoFiles === 1 ? "it makes" : "they make"} no facts.
							</p>
						)}
					</div>
				</>
			)}
		</section>
	);
}

const LOOSE_STATE: Record<Exclude<Slot["state"], "missing">, string> = {
	ready: "read",
	reading: "being read",
	failed: "couldn't be read",
	info: "course info",
};

/** Each state is its own shape, not only its own color: read is full,
 *  being read is half full, failed is a red diamond, course info is an
 *  empty box, missing is a dashed red box. */
const SLOT_CLASS: Record<Slot["state"], string> = {
	ready: "bg-ink",
	reading: "bg-[linear-gradient(to_top,var(--lh-ink-3)_50%,transparent_50%)] shadow-[inset_0_0_0_1px_var(--lh-ink-3)]",
	failed: "rotate-45 scale-[0.78] bg-ans-wrong",
	info: "shadow-[inset_0_0_0_1px_var(--lh-ink-3)]",
	missing: "border border-dashed border-ans-wrong",
};

function SeriesRow({ series: s }: { series: MaterialSeries }) {
	return (
		<div data-testid="deadline-series" className="flex w-full min-w-0 items-center gap-4">
			<span className="w-[170px] shrink-0 truncate text-[13.5px] font-bold text-ink" title={s.label}>
				{s.label}
			</span>
			<div className="flex min-w-0 flex-1 flex-wrap gap-[3px]">
				{s.slots.map((slot) => (
					<Tip key={slot.number} title={slotTitle(s, slot)} body={<span className="text-xs text-ink-2">{slotBody(slot)}</span>}>
						<span
							data-testid="deadline-slot"
							data-state={slot.state}
							role="img"
							tabIndex={0}
							aria-label={`${slotTitle(s, slot)}: ${slotBody(slot)}`}
							className={cn("size-3.5 shrink-0", SLOT_CLASS[slot.state])}
						/>
					</Tip>
				))}
			</div>
			<span className="w-[64px] shrink-0 text-right text-[12.5px] text-ink-2">
				{s.infoOnly ? "no facts" : <span className="font-mono tabular-nums">{`${s.present}/${s.last}`}</span>}
			</span>
		</div>
	);
}

function slotTitle(s: MaterialSeries, slot: Slot): string {
	const name = `${s.label} ${slot.number}`;
	return slot.date ? `${name} · ${deadlineDateLabel(slot.date)}` : name;
}

function slotBody(slot: Slot): string {
	if (slot.state === "missing") return "No file with this number. Add it on the Files page if the class had one.";
	const files = slot.names.join(", ");
	if (slot.state === "reading") return `${files} · being read`;
	if (slot.state === "failed") return `${files} · couldn't be read, retry it on the Files page`;
	if (slot.state === "info") return `${files} · course info, no facts`;
	return files;
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
			<p data-testid="deadline-path-note" className="text-[13.5px] leading-5 text-ink-2">
				{pathNote(d, past, plan.length > 0, allStrong, material)}
			</p>
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
										<span className="min-w-0 flex-1 truncate text-ink">{t.name}</span>
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
					<ActionBar testId="deadline-start" label={plan.length > 0 ? "Start today" : "Practice all its topics"} onClick={onStart} disabled={busy} />
				</div>
			)}
		</section>
	);
}

function pathNote(d: DeadlineProgress, past: boolean, hasPlan: boolean, allStrong: boolean, m: Material | null): string {
	if (d.done) return "Marked done.";
	if (past) return `This was due ${dueLabel(d.date, d.time)}.`;
	if (hasPlan) return d.daysUntil === 0 ? "Due today, so everything that needs work is on today." : "Topics that need work, weakest first.";
	if (allStrong) return "Every topic is strong. Practice them to keep it that way.";
	if (d.files.length === 0) return "Pick the files it covers in Edit class to get a plan.";
	if (m && m.reading > 0) return "Its files are still being read. The plan shows up once their facts are built.";
	return "Its files have no facts yet, so there is nothing to plan. Course info files never make facts.";
}
