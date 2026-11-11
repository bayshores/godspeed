/**
 * The Graph page's right side when no topic is picked, and its top sheet
 * always: the picked deadline (its name, "Change deadline" to pick
 * another, when it's due, what it covers, how many of its topics are
 * ready, and its Study button), then "Work on next": the strong / shaky /
 * weak / not tested counts and the topics to work on, with Study these N.
 * With no open deadline that has files, the lower sheet covers the whole class.
 */
import { memo, useCallback, useRef, useState } from "react";
import { deadlineStudyLabel, type DeadlineProgress, type TopicProgress, type WorkOnNextItem } from "@/shared/core";
import { longDay } from "@/frontend/components/home-page/home-page-model";
import { MenuShell } from "@/frontend/components/menu-shell";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { ProgressBar } from "@/frontend/components/ui/progress-bar";
import { Tip } from "@/frontend/components/ui/tooltip";
import { cn } from "@/frontend/lib/utils";
import { countdownText, countsLine, deadlineFilesText, readyCount, reasonText, workRowLine } from "./derive.ts";
import { MENU_ITEM_CLASS } from "./menu.tsx";
import { SIDE_TITLE } from "./styles.ts";

/** "Work on next" shows this many. */
const WORK_ON_NEXT_LIMIT = 4;

/** A sheet's main action, with why the last start failed under it. */
export function StudyButton({
	label,
	onClick,
	busy,
	error,
	testid,
	main = true,
}: {
	label: string;
	onClick: () => void;
	busy: boolean;
	error: string | null;
	testid: string;
	/** The filled button with a play mark; false is the outlined one. */
	main?: boolean;
}) {
	return (
		<div className="flex flex-col gap-2">
			<button
				type="button"
				data-testid={testid}
				disabled={busy}
				onClick={onClick}
				className={cn("lh-btn h-auto w-full justify-center py-3 text-[15px]", main && "lh-btn-main")}
			>
				{main && <PixelIcon name="play" />}
				<span className="min-w-0 truncate">{label}</span>
			</button>
			{error && (
				<p role="alert" data-testid="study-start-error" className="text-sm text-ans-wrong">
					{error}
				</p>
			)}
		</div>
	);
}

/** A side sheet's quiet Close. */
export function CloseButton({ testid, onClick }: { testid: string; onClick: () => void }) {
	return (
		<button type="button" data-testid={testid} onClick={onClick} className="lh-btn lh-btn-quiet shrink-0 px-1 text-[15px]">
			<PixelIcon name="close" />
			Close
		</button>
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
	const ready = readyCount(covered);
	const files = deadlineFilesText(deadline.files);
	const when = countdownText(deadline.daysUntil);
	return (
		<Pane data-testid="deadline-pane" className="flex flex-col gap-2.5 p-5">
			<div className="flex items-center gap-2">
				<h2 title={deadline.name} className={`${SIDE_TITLE} flex-1`}>
					{deadline.name}
				</h2>
				{deadlines.length > 1 && <DeadlinePicker deadlines={deadlines} deadline={deadline} onChange={onChange} />}
			</div>
			<p data-testid="deadline-countdown" className="font-count text-[15px] text-ink-2">
				{deadline.daysUntil > 0 ? `in ${when}` : when}, {longDay(deadline.date)}
			</p>
			{files &&
				(deadline.files.length > 1 ? (
					<Tip title={deadline.name} body={<span className="text-xs text-ink-2">{deadline.files.map((f) => f.name).join(", ")}</span>}>
						<span tabIndex={0} data-testid="deadline-files" className="self-start truncate text-base text-ink-2 outline-none">
							Covers {files}
						</span>
					</Tip>
				) : (
					<span data-testid="deadline-files" className="truncate text-base text-ink-2">
						Covers {files}
					</span>
				))}
			{covered.length > 0 && (
				<>
					<ProgressBar share={ready / covered.length} className="w-full" />
					<span data-testid="deadline-ready" className="text-base text-ink-2">
						{ready} of {covered.length} topics ready
					</span>
				</>
			)}
			<StudyButton
				testid="study-deadline"
				label={deadlineStudyLabel(deadline.continueStudy, deadline.name)}
				busy={studying}
				error={studyError}
				onClick={() => onStudy(deadline)}
			/>
		</Pane>
	);
}

// The picker's fixed width, so a long deadline name truncates.
const PICKER_MENU_CLASS = "lh-popup flex w-[236px] flex-col gap-0.5 p-1.5 text-[13.5px]";

/** "Change deadline": a menu of the other deadlines to show here. */
function DeadlinePicker({ deadlines, deadline, onChange }: { deadlines: readonly DeadlineProgress[]; deadline: DeadlineProgress; onChange: (id: string) => void }) {
	const [open, setOpen] = useState(false);
	const anchorRef = useRef<HTMLButtonElement>(null);
	const close = useCallback(() => setOpen(false), []);
	useMenuDismiss(open, close, anchorRef);
	return (
		<>
			<button
				ref={anchorRef}
				type="button"
				data-testid="deadline-picker"
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen((o) => !o)}
				className="lh-btn lh-btn-quiet shrink-0 px-1 text-[15px]"
			>
				Change deadline
			</button>
			<MenuShell open={open} anchorRef={anchorRef} testid="deadline-picker-menu" preferredSide="down" align="right" menuClass={PICKER_MENU_CLASS}>
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
		<Pane data-testid="work-on-next-pane" className="flex flex-col gap-2.5 p-5">
			<h2 className={SIDE_TITLE}>Work on next</h2>
			<p data-testid="status-counts" className="text-base text-ink-2">
				{countsLine(scope.counts)}
			</p>
			<span aria-hidden className="border-t-2 border-dotted border-edge" />
			{next.length > 0 ? (
				<ol className="flex flex-col" data-testid="work-on-next">
					{next.map((item) => (
						<NextRow key={item.topicId} item={item} topic={byId.get(item.topicId)} onSelect={onSelectTopic} />
					))}
				</ol>
			) : (
				<p className="text-base text-ink-2">Nothing to work on yet.</p>
			)}
			{next.length > 0 && (
				<StudyButton
					testid="study-these"
					main={false}
					label={`Study these ${next.length}`}
					busy={studying}
					error={studyError}
					onClick={() => onStudy(next.map((n) => n.topicId))}
				/>
			)}
		</Pane>
	);
}

const NextRow = memo(function NextRow({ item, topic, onSelect }: { item: WorkOnNextItem; topic: TopicProgress | undefined; onSelect: (id: string) => void }) {
	const reason = reasonText(item);
	return (
		<li>
			<button
				type="button"
				data-testid="work-on-next-row"
				onClick={() => onSelect(item.topicId)}
				className="lh-press -mx-1 flex w-[calc(100%+8px)] flex-col gap-px px-1 py-1 text-left hover:bg-tone"
			>
				<span title={item.name} className="truncate text-[15px] font-medium text-ink">
					{item.name}
				</span>
				<span className="text-base text-ink-2">{topic ? workRowLine(topic) : ""}</span>
				{reason && <span className="text-base text-ink-2">{reason}</span>}
			</button>
		</li>
	);
});
