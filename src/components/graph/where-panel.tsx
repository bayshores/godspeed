/**
 * The right panel with nothing selected — "Where you're at": the exam
 * picker and countdown, one block per topic on the exam (strong first),
 * the strong / shaky / weak / not tested counts, the "Work on next" list
 * and "Practice these N". With no exams it shows the class-wide view.
 */
import { memo, useCallback, useRef, useState } from "react";
import { CalendarIcon, ChevronDownIcon, DumbbellIcon } from "lucide-react";
import type { ExamProgress, ProgressPayload, StatusCounts, TopicProgress, WorkOnNextItem } from "@/core";
import { MenuShell } from "@/components/menu-shell";
import { Tip } from "@/components/ui/tooltip";
import { countdownText, examDateText, examFilesText, readinessBlocks, reasonText, STATUS_COLOR, statusLine } from "./derive.ts";
import { MENU_CLASS, MENU_ITEM_CLASS, useMenuDismiss } from "./menu.tsx";

/** "Work on next" shows this many (the design's "Practice these 4"). */
export const WORK_ON_NEXT_LIMIT = 4;

const HEAD = "text-[13px] font-bold text-ink-3";

export function WherePanel({
	data,
	examId,
	onExamChange,
	onSelectTopic,
	onPractice,
	practicing,
}: {
	data: Pick<ProgressPayload, "exams" | "overall" | "topics">;
	examId: string | null;
	onExamChange: (id: string) => void;
	onSelectTopic: (id: string) => void;
	onPractice: (topicIds: string[]) => void;
	practicing: boolean;
}) {
	const exam = data.exams.find((e) => e.id === examId) ?? null;
	const scope = exam ?? data.overall;
	const byId = new Map(data.topics.map((t) => [t.id, t]));
	const scoped = scope.topicIds.map((id) => byId.get(id)).filter((t): t is TopicProgress => !!t);
	const next = scope.workOnNext.slice(0, WORK_ON_NEXT_LIMIT);
	return (
		<aside data-testid="where-panel" className="flex h-full w-[400px] shrink-0 flex-col border-l border-tone-2 bg-panel">
			<div className="min-h-0 flex-1 overflow-y-auto px-6 py-[22px]">
				{exam && (
					<>
						<ExamPicker exams={data.exams} exam={exam} onChange={onExamChange} />
						<Countdown exam={exam} />
						<div className="h-[18px]" />
					</>
				)}
				<h2 className={HEAD}>Where you&apos;re at</h2>
				<div className="h-2" />
				<Readiness topics={scoped} />
				<div className="h-2.5" />
				<Counts counts={scope.counts} />
				{next.length > 0 && (
					<>
						<div className="h-6" />
						<h2 className={HEAD}>Work on next</h2>
						<div className="h-2" />
						<ol className="flex flex-col gap-0.5" data-testid="work-on-next">
							{next.map((item, i) => (
								<NextRow key={item.topicId} index={i + 1} item={item} topic={byId.get(item.topicId)} onSelect={onSelectTopic} />
							))}
						</ol>
					</>
				)}
			</div>
			{next.length > 0 && (
				<PracticeBar
					testid="practice-these"
					label={`Practice these ${next.length}`}
					busy={practicing}
					onClick={() => onPractice(next.map((n) => n.topicId))}
				/>
			)}
		</aside>
	);
}

function ExamPicker({ exams, exam, onChange }: { exams: readonly ExamProgress[]; exam: ExamProgress; onChange: (id: string) => void }) {
	const [open, setOpen] = useState(false);
	const anchorRef = useRef<HTMLButtonElement>(null);
	const close = useCallback(() => setOpen(false), []);
	useMenuDismiss(open, close, anchorRef);
	return (
		<>
			<button
				ref={anchorRef}
				type="button"
				data-testid="exam-picker"
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen((o) => !o)}
				className="lh-press flex w-full items-center gap-2 bg-tone px-2.5 py-2 text-left text-sm font-bold text-ink hover:bg-tone-2"
			>
				<CalendarIcon className="size-3.5 shrink-0 text-ink-2" aria-hidden />
				<span className="min-w-0 flex-1 truncate">{exam.name}</span>
				<ChevronDownIcon className="size-3.5 shrink-0 text-ink-2" aria-hidden />
			</button>
			<MenuShell open={open} anchorRef={anchorRef} testid="exam-picker-menu" preferredSide="down" align="left" menuClass={MENU_CLASS}>
				{exams.map((e) => (
					<button
						key={e.id}
						type="button"
						role="menuitemradio"
						aria-checked={e.id === exam.id}
						onClick={() => {
							onChange(e.id);
							setOpen(false);
						}}
						className={`${MENU_ITEM_CLASS} ${e.id === exam.id ? "font-bold text-ink" : ""}`}
					>
						{e.name}
					</button>
				))}
			</MenuShell>
		</>
	);
}

function Countdown({ exam }: { exam: ExamProgress }) {
	const files = examFilesText(exam.files);
	const line = (
		<span className="pb-1.5 text-[13.5px] text-ink-3">
			{examDateText(exam.date)}
			{files ? ` · ${files}` : ""}
		</span>
	);
	return (
		<div className="mt-4 flex items-end gap-2.5" data-testid="exam-countdown">
			<span className="text-[34px] font-extrabold leading-none text-ink">{countdownText(exam.daysUntil)}</span>
			{exam.files.length > 1 ? (
				<Tip title={exam.name} body={<span className="text-xs text-ink-2">{exam.files.map((f) => f.name).join(", ")}</span>}>
					<span tabIndex={0} className="outline-none">
						{line}
					</span>
				</Tip>
			) : (
				line
			)}
		</div>
	);
}

const Readiness = memo(function Readiness({ topics }: { topics: readonly TopicProgress[] }) {
	if (topics.length === 0) return <div className="h-[22px] bg-tone" />;
	return (
		<div className="flex w-full gap-[3px]" data-testid="readiness" aria-hidden>
			{readinessBlocks(topics).map((t) => {
				const color = STATUS_COLOR[t.status];
				return (
					<span
						key={t.id}
						className={`h-[22px] flex-1 ${color ? "" : "outline outline-[1.5px] -outline-offset-[0.75px] outline-ink-3"}`}
						style={color ? { background: color } : undefined}
					/>
				);
			})}
		</div>
	);
});

const COUNT_KEYS: { key: keyof StatusCounts; label: string }[] = [
	{ key: "strong", label: "strong" },
	{ key: "shaky", label: "shaky" },
	{ key: "weak", label: "weak" },
	{ key: "untested", label: "not tested" },
];

function Counts({ counts }: { counts: StatusCounts }) {
	return (
		<div className="flex w-full justify-between text-[13px]" data-testid="status-counts">
			{COUNT_KEYS.map(({ key, label }) => (
				<span key={key} className="flex items-center gap-[5px]">
					<StatusMark status={key} size="size-2" />
					<span className="font-mono font-bold text-ink">{counts[key]}</span>
					<span className="text-ink-3">{label}</span>
				</span>
			))}
		</div>
	);
}

/** A status swatch: filled ramp color, or an empty outline when untested. */
export function StatusMark({ status, size, round = false }: { status: keyof StatusCounts; size: string; round?: boolean }) {
	const color = STATUS_COLOR[status];
	return (
		<span
			aria-hidden
			className={`${size} shrink-0 ${round ? "rounded-full" : ""} ${color ? "" : "outline outline-[1.5px] -outline-offset-[0.75px] outline-ink-3"}`}
			style={color ? { background: color } : undefined}
		/>
	);
}

const NextRow = memo(function NextRow({
	index,
	item,
	topic,
	onSelect,
}: {
	index: number;
	item: WorkOnNextItem;
	topic: TopicProgress | undefined;
	onSelect: (id: string) => void;
}) {
	const color = STATUS_COLOR[item.status];
	return (
		<li>
			<button
				type="button"
				data-testid="work-on-next-row"
				onClick={() => onSelect(item.topicId)}
				className="lh-press flex w-full items-start gap-3 bg-tone px-3 py-[11px] text-left hover:bg-tone-2"
			>
				<span className="font-mono text-[13px] font-bold text-ink-3">{index}</span>
				<span className="flex min-w-0 flex-col gap-[3px]">
					<span className="flex items-center gap-[7px]">
						<StatusMark status={item.status} size="size-[9px]" round />
						<span className="truncate text-[14.5px] font-bold text-ink">{item.name}</span>
					</span>
					<span className="text-[12.5px] font-bold" style={{ color: color ?? "var(--color-ink-2)" }}>
						{topic ? statusLine(topic) : ""}
					</span>
					<span className="text-[12.5px] text-ink-3">{reasonText(item)}</span>
				</span>
			</button>
		</li>
	);
});

/** The panel's full-width white bottom button. */
export function PracticeBar({ label, onClick, busy, testid }: { label: string; onClick: () => void; busy: boolean; testid: string }) {
	return (
		<button
			type="button"
			data-testid={testid}
			disabled={busy}
			onClick={onClick}
			className="lh-press flex h-14 w-full shrink-0 items-center gap-2 bg-primary px-5 text-[15px] font-extrabold text-primary-foreground hover:opacity-90 disabled:opacity-60"
		>
			<DumbbellIcon className="size-4" aria-hidden />
			{label}
		</button>
	);
}
