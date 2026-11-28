import { memo, type ReactNode } from "react";
import { cn } from "@/frontend/lib/utils";
import { hasProblems, rampColor, studyLabel, type DeadlineProgress, type PlanDay } from "@/shared/core";
import { isOverdue } from "@/frontend/components/deadlines-model";
import { StepBlocks } from "@/frontend/components/overview/lesson-rows";
import { STATUS_LEGEND, progressWords } from "@/frontend/components/overview/overview-model";
import { MAIN_KEY } from "@/frontend/components/ui/big-key";
import { barWord } from "@/frontend/components/top-bar/bar-look";
import { BarActions, BarCrumb, CrumbName } from "@/frontend/components/top-bar/bar-slots";
import { Key } from "@/frontend/components/ui/key";
import { Pane } from "@/frontend/components/ui/pane";
import { Tip } from "@/frontend/components/ui/tooltip";
import { CoversSheet } from "./covers-sheet";
import { DeadlineBlock } from "./deadline-block";
import { DeadlineKeys } from "./deadline-keys";
import { rightLabel, whenLine, type Material, type TopicTally } from "./deadline-model";
import { PathSheet } from "./path-sheet";
import type { RequestKind } from "./request-model";

/**
 * ONE DEADLINE'S PAGE (pure view, the render-test seam): its head sheet
 * (the time left as a block on its left edge, when it is, how far it is
 * drawn as a homework's problem blocks and its topics as a strip colored by
 * how you do, and at its end Study, or a homework's two keys); what it's
 * like; a homework's problems; What's on it and the path to it with its
 * mocks, then its lessons once it has two. The deadline's name is the top bar's
 * crumb (the page keeps it as a hidden h1), and Cheat sheet and Edit deadline
 * are words at the bar's right. An interview has no cheat sheet, and no
 * What's on it until files are linked.
 */

interface DeadlineBodyProps {
	deadline: DeadlineProgress;
	/** The space's color. */
	color: string;
	/** The space's topics, for each one's "2 of 5 right". */
	topics: readonly TopicTally[];
	/** Null while the space's files load. */
	material: Material | null;
	plan: readonly PlanDay[];
	nowMs: number;
	busyOn: string | null;
	/** Why the last Study start failed. */
	startError: string | null;
	onStart: () => void;
	/** Works on a homework or project. */
	onWork: () => void;
	/** Opens "Edit deadline". */
	onEdit: () => void;
	/** Where the agent found what it covers. */
	source: string | undefined;
	teacherName: string;
	/** An Add or Leave out is being saved. */
	saving: boolean;
	/** A request to the agent runs on this deadline. */
	requesting: boolean;
	/** The line beside each Ask button after its request changed nothing. */
	requestLine: (kind: RequestKind) => string | null;
	onRequest: (kind: RequestKind) => void;
	onAdd: (fileIds: string[]) => void;
	onLeaveOut: (fileIds: string[]) => void;
	/** Opens the cheat sheet studio. */
	onCheatSheet: () => void;
	/** What it's like (about-sheet.tsx), when the teacher wrote it. */
	about?: ReactNode;
	/** A homework or project's problems (homework-card.tsx). */
	homework?: ReactNode;
	/** A test's or interview's mocks (path-mocks.tsx). */
	mocks?: ReactNode;
	/** The lessons for it, once there are two (lesson-card.tsx). */
	lessons?: ReactNode;
	/** The page showed its wait first, so its parts step in. */
	waited: boolean;
}

export const DeadlineBody = memo(function DeadlineBody(props: DeadlineBodyProps) {
	const { deadline: d, nowMs } = props;
	const past = !d.done && isOverdue(d, nowMs);
	const progress = progressWords(d);
	const tallies = new Map(props.topics.map((t) => [t.id, t]));
	const interview = d.kind === "interview";
	// A homework's two keys stay once it is past; Study alone goes with the date.
	const keys = hasProblems(d.kind) ? (
		!d.done && <DeadlineKeys deadline={d} busyOn={props.busyOn} onStudy={props.onStart} onWork={props.onWork} />
	) : (
		!d.done &&
		!past && (
			<Key data-testid="deadline-start" busy={props.busyOn === d.id} disabled={props.busyOn !== null} onClick={props.onStart} className={MAIN_KEY}>
				<span className="min-w-0 truncate">{studyLabel(d.continueStudy)}</span>
			</Key>
		)
	);
	return (
		<div data-testid="deadline-page" className={cn("@container flex w-full flex-col gap-(--lh-gap)", props.waited && "lh-set")}>
			<h1 data-testid="deadline-name" className="sr-only">
				{d.name}
			</h1>
			<BarCrumb>
				<span title={d.name} className="flex">
					<CrumbName text={d.name} />
				</span>
			</BarCrumb>
			<BarActions>
				{!interview && (
					<button type="button" data-testid="deadline-cheat-sheet" onClick={props.onCheatSheet} className={barWord(false)}>
						Cheat sheet
					</button>
				)}
				<button type="button" data-testid="deadline-edit" onClick={props.onEdit} className={barWord(false)}>
					Edit deadline
				</button>
			</BarActions>
			{/* Cut to the sheet's corners, so the block follows them. */}
			<Pane data-testid="deadline-head" data-teacher-target={`deadline:${d.id}`} className="@container/head overflow-hidden">
				<header className="flex flex-col @[640px]/head:flex-row @[640px]/head:items-center">
					<DeadlineBlock deadline={d} color={props.color} nowMs={nowMs} size="head" />
					<div className="flex min-w-0 flex-1 flex-col gap-3 px-(--lh-inset) py-4">
						<p data-testid="deadline-when" className="text-ask leading-tight text-ink">
							{whenLine(d)}
						</p>
						{progress && (d.problems || d.topics.length === 0) && (
							<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-item text-ink-2">
								{d.problems && <StepBlocks done={d.problems.done} total={d.problems.total} />}
								<span data-testid="deadline-progress">{progress}</span>
							</div>
						)}
						{d.topics.length > 0 && <TopicStrip deadline={d} tallies={tallies} ready={d.problems ? null : progress} />}
					</div>
					{keys && <div className="flex shrink-0 px-(--lh-inset) pb-5 @[640px]/head:py-4 @[640px]/head:pl-0">{keys}</div>}
				</header>
			</Pane>
			{props.startError && (
				<p role="alert" data-testid="deadline-start-error" className="text-ui text-ans-wrong">
					{props.startError}
				</p>
			)}

			<div className="flex flex-col gap-(--lh-gap)">
				<div className="flex flex-col items-start gap-(--lh-gap) @4xl:flex-row">
					{/* Grows only beside the path: stacked, WebKit kept its height from before a resize. */}
					<div className="flex w-full min-w-0 flex-col gap-(--lh-gap) @4xl:flex-1">
						{props.about}
						{props.homework}
						{!(interview && d.files.length === 0) && (
							<CoversSheet
								deadline={d}
								material={props.material}
								source={props.source}
								teacherName={props.teacherName}
								saving={props.saving}
								requesting={props.requesting}
								requestLine={props.requestLine("coverage")}
								onEdit={props.onEdit}
								onAsk={() => props.onRequest("coverage")}
								onAdd={props.onAdd}
								onLeaveOut={props.onLeaveOut}
							/>
						)}
					</div>
					<div className="flex w-full flex-col gap-(--lh-gap) @4xl:w-[400px] @4xl:shrink-0">
						<PathSheet
							deadline={d}
							plan={props.plan}
							material={props.material}
							tallies={tallies}
							past={past}
							teacherName={props.teacherName}
							requesting={props.requesting}
							guideLine={props.requestLine("guide")}
							onAskGuide={() => props.onRequest("guide")}
							mocks={props.mocks}
						/>
						{props.lessons}
					</div>
				</div>
			</div>
		</div>
	);
});

/** The deadline's topics as one bar, weakest first, with how many are in each state; `ready` leads that line ("19% ready"). */
function TopicStrip({ deadline: d, tallies, ready }: { deadline: DeadlineProgress; tallies: ReadonlyMap<string, TopicTally>; ready: string | null }) {
	return (
		<div className="flex flex-col gap-2">
			<div data-testid="deadline-topics" className="flex h-4 w-full gap-[3px]">
				{d.topics.map((t) => (
					<Tip key={t.id} title={t.name} body={rightLabel(tallies.get(t.id))}>
						{/* Focusable and named, so the tip isn't for the mouse only. */}
						<span
							data-testid="deadline-topic"
							role="img"
							tabIndex={0}
							aria-label={`${t.name}: ${rightLabel(tallies.get(t.id))}`}
							className="h-full min-w-1 flex-1"
							style={{ background: rampColor(t.rate) }}
						/>
					</Tip>
				))}
			</div>
			<div className="flex flex-wrap items-center gap-x-[18px] gap-y-1 text-ui text-ink-2">
				{ready && (
					<span data-testid="deadline-progress" className="text-item text-ink">
						{ready}
					</span>
				)}
				{STATUS_LEGEND.filter((l) => d.counts[l.key] > 0).map((l) => (
					<span key={l.key} data-testid={`deadline-count-${l.key}`} className="flex items-center gap-1.5">
						<span className="size-2.5 shrink-0" style={{ background: rampColor(l.rate) }} aria-hidden />
						{d.counts[l.key]} {l.label}
					</span>
				))}
			</div>
		</div>
	);
}
