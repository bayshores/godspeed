/**
 * The Graph page's right side when no topic is picked, and its top pane
 * always: "next: <deadline>" (the picker, when it's due, one block per
 * covered topic, how many are ready, and its Study button), then "work on
 * next": the strong / shaky / weak / not tested counts and the topics to
 * work on, with Study these N. With no open deadline that has files, the
 * lower pane covers the whole class.
 */
import { memo, useCallback, useRef, useState } from "react";
import { dayLabel, deadlineStudyLabel, type DeadlineProgress, type StatusCounts, type TopicProgress, type WorkOnNextItem } from "@/shared/core";
import { MenuShell } from "@/frontend/components/menu-shell";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { Pane } from "@/frontend/components/ui/pane";
import { Tip } from "@/frontend/components/ui/tooltip";
import { countdownText, deadlineFilesText, readinessBlocks, readyCount, reasonText, STATUS_COLOR, statusLine } from "./derive.ts";
import { MENU_ITEM_CLASS } from "./menu.tsx";

/** "Work on next" shows this many. */
const WORK_ON_NEXT_LIMIT = 4;

/** The right side's width: up to 400, narrower in a narrow window so the columns keep room. */
export const SIDE_WIDTH = "w-[clamp(300px,30vw,400px)]";

/** A pane's main action, with why the last start failed under it. */
export function StudyButton({ label, onClick, busy, error, testid }: { label: string; onClick: () => void; busy: boolean; error: string | null; testid: string }) {
	return (
		<div className="flex flex-col gap-2">
			<button type="button" data-testid={testid} disabled={busy} onClick={onClick} className="lh-btn lh-btn-main max-w-full">
				<span aria-hidden>▶</span>
				<span className="truncate">{label}</span>
			</button>
			{error && (
				<p role="alert" data-testid="study-start-error" className="text-[13px] text-ans-wrong">
					{error}
				</p>
			)}
		</div>
	);
}

export function DeadlinePane({
	deadlines,
	deadline,
	topics,
	onChange,
	onStudy,
	studying,
	studyError,
}: {
	/** The deadlines the picker offers (pickableDeadlines). */
	deadlines: readonly DeadlineProgress[];
	deadline: DeadlineProgress;
	topics: readonly TopicProgress[];
	onChange: (id: string) => void;
	onStudy: (deadline: DeadlineProgress) => void;
	studying: boolean;
	studyError: string | null;
}) {
	const byId = new Map(topics.map((t) => [t.id, t]));
	const covered = deadline.topicIds.map((id) => byId.get(id)).filter((t): t is TopicProgress => !!t);
	const files = deadlineFilesText(deadline.files);
	const when = countdownText(deadline.daysUntil);
	return (
		<Pane name="next" data-testid="deadline-pane" className="[&>h2]:p-0 flex shrink-0 flex-col gap-3 px-5 pt-4 pb-4">
			<DeadlinePicker deadlines={deadlines} deadline={deadline} onChange={onChange} />
			<div className="flex items-baseline justify-between gap-3" data-testid="deadline-countdown">
				<span className="text-xl font-bold text-ink">{deadline.daysUntil > 0 ? `in ${when}` : when.toLowerCase()}</span>
				{deadline.files.length > 1 ? (
					<Tip title={deadline.name} body={<span className="text-xs text-ink-2">{deadline.files.map((f) => f.name).join(", ")}</span>}>
						<span tabIndex={0} className="truncate text-[13px] text-ink-3 outline-none">
							{dayLabel(deadline.date)}, covers {files}
						</span>
					</Tip>
				) : (
					<span className="truncate text-[13px] text-ink-3">
						{dayLabel(deadline.date)}
						{files ? `, covers ${files}` : ""}
					</span>
				)}
			</div>
			{covered.length > 0 && (
				<div className="flex items-center gap-3">
					<Readiness topics={covered} />
					<span data-testid="deadline-ready" className="shrink-0 text-[13px] text-ink-3">
						{readyCount(covered)} of {covered.length} ready
					</span>
				</div>
			)}
			<StudyButton testid="study-deadline" label={deadlineStudyLabel(deadline.continueStudy).toLowerCase()} busy={studying} error={studyError} onClick={() => onStudy(deadline)} />
		</Pane>
	);
}

// The picker's fixed width, so a long deadline name truncates.
const PICKER_MENU_CLASS = "lh-popup flex w-[236px] flex-col gap-0.5 p-1.5 text-[13.5px]";

function DeadlinePicker({ deadlines, deadline, onChange }: { deadlines: readonly DeadlineProgress[]; deadline: DeadlineProgress; onChange: (id: string) => void }) {
	const [open, setOpen] = useState(false);
	const anchorRef = useRef<HTMLButtonElement>(null);
	const close = useCallback(() => setOpen(false), []);
	useMenuDismiss(open, close, anchorRef);
	const one = deadlines.length < 2;
	return (
		<>
			<button
				ref={anchorRef}
				type="button"
				data-testid="deadline-picker"
				aria-haspopup={one ? undefined : "menu"}
				aria-expanded={one ? undefined : open}
				disabled={one}
				onClick={() => setOpen((o) => !o)}
				className="lh-press flex min-w-0 items-baseline gap-[1ch] self-start text-left text-[15px] font-bold text-ink enabled:hover:text-ink-max"
			>
				<span title={deadline.name} className="min-w-0 truncate">
					{deadline.name}
				</span>
				{!one && (
					<span aria-hidden className="text-ink-3">
						▾
					</span>
				)}
			</button>
			<MenuShell open={open} anchorRef={anchorRef} testid="deadline-picker-menu" preferredSide="down" align="left" menuClass={PICKER_MENU_CLASS}>
				{deadlines.map((d) => (
					<button
						key={d.id}
						type="button"
						role="menuitemradio"
						aria-checked={d.id === deadline.id}
						onClick={() => {
							onChange(d.id);
							setOpen(false);
						}}
						title={d.name}
						className={`${MENU_ITEM_CLASS} ${d.id === deadline.id ? "font-bold text-ink" : ""}`}
					>
						<span className="min-w-0 flex-1 truncate">{d.name}</span>
					</button>
				))}
			</MenuShell>
		</>
	);
}

/** One block per topic, strong first, in its status color. */
const Readiness = memo(function Readiness({ topics }: { topics: readonly TopicProgress[] }) {
	return (
		<div className="flex min-w-0 flex-1 gap-[2px]" data-testid="readiness" aria-hidden>
			{readinessBlocks(topics).map((t) => (
				<span key={t.id} className="h-2.5 min-w-[3px] flex-1" style={{ background: STATUS_COLOR[t.status] ?? "var(--border)" }} />
			))}
		</div>
	);
});

const COUNT_KEYS: { key: keyof StatusCounts; label: string }[] = [
	{ key: "strong", label: "strong" },
	{ key: "shaky", label: "shaky" },
	{ key: "weak", label: "weak" },
	{ key: "untested", label: "not tested" },
];

export function WorkOnNextPane({
	scope,
	topics,
	onSelectTopic,
	onStudy,
	studying,
	studyError,
}: {
	/** The picked deadline, or the whole class. */
	scope: Pick<DeadlineProgress, "counts" | "workOnNext">;
	topics: readonly TopicProgress[];
	onSelectTopic: (id: string) => void;
	onStudy: (topicIds: string[]) => void;
	studying: boolean;
	studyError: string | null;
}) {
	const byId = new Map(topics.map((t) => [t.id, t]));
	const next = scope.workOnNext.slice(0, WORK_ON_NEXT_LIMIT);
	return (
		<Pane name="work on next" data-testid="work-on-next-pane" className="flex min-h-0 flex-1 flex-col">
			<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pt-5 pb-4">
				<div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]" data-testid="status-counts">
					{COUNT_KEYS.map(({ key, label }) => (
						<span key={key} className="flex items-center gap-[6px]">
							<StatusMark status={key} />
							<span className="font-bold text-ink tabular-nums">{scope.counts[key]}</span>
							<span className="text-ink-3">{label}</span>
						</span>
					))}
				</div>
				{next.length > 0 ? (
					<ol className="flex flex-col gap-0.5" data-testid="work-on-next">
						{next.map((item) => (
							<NextRow key={item.topicId} item={item} topic={byId.get(item.topicId)} onSelect={onSelectTopic} />
						))}
					</ol>
				) : (
					<p className="text-sm text-ink-3">Nothing to work on yet.</p>
				)}
			</div>
			{next.length > 0 && (
				<div className="shrink-0 px-5 pb-5">
					<StudyButton testid="study-these" label={`study these ${next.length}`} busy={studying} error={studyError} onClick={() => onStudy(next.map((n) => n.topicId))} />
				</div>
			)}
		</Pane>
	);
}

/** A status square: the ramp color, or the border color when untested. */
function StatusMark({ status }: { status: keyof StatusCounts }) {
	return <span aria-hidden className="size-2 shrink-0" style={{ background: STATUS_COLOR[status] ?? "var(--border)" }} />;
}

const NextRow = memo(function NextRow({ item, topic, onSelect }: { item: WorkOnNextItem; topic: TopicProgress | undefined; onSelect: (id: string) => void }) {
	return (
		<li>
			<button
				type="button"
				data-testid="work-on-next-row"
				onClick={() => onSelect(item.topicId)}
				className="lh-press flex w-full flex-col gap-[3px] px-2.5 py-2 text-left hover:bg-tone"
			>
				<span className="flex items-center gap-2">
					<StatusMark status={item.status} />
					<span title={item.name} className="truncate text-[14px] font-bold text-ink">
						{item.name}
					</span>
				</span>
				<span className="pl-4 text-[12.5px]" style={{ color: STATUS_COLOR[item.status] ?? "var(--color-ink-2)" }}>
					{topic ? statusLine(topic) : ""}
				</span>
				{reasonText(item) && <span className="pl-4 text-[12.5px] text-ink-3">{reasonText(item)}</span>}
			</button>
		</li>
	);
});
