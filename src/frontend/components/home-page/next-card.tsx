import { MAIN_KEY } from "@/frontend/components/overview/styles";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router";
import type { DeadlineProgress, RhythmGap, SpaceColor } from "@/shared/core";
import { dueAtMs } from "@/frontend/components/countdown-model";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { deadlineHref } from "@/frontend/components/overview/overview-model";
import { DoneBlock } from "@/frontend/components/deadline/deadline-block";
import { seedFromGap } from "@/frontend/components/space-deadlines-model";
import { blockColor, spaceLineColor } from "@/frontend/components/space-color";
import { addDeadlineHref } from "@/frontend/components/space-page/deadlines-tab-model";
import { homeworkStartId } from "@/frontend/components/study-page/use-lesson-start";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { updateLine } from "@/frontend/components/terminal/starter-model";
import { Key } from "@/frontend/components/ui/key";
import { CountBlock } from "@/frontend/components/ui/count-block";
import { Pane } from "@/frontend/components/ui/pane";
import { useGuardedAction } from "@/frontend/components/use-guarded-action";
import { useOpenInSpace } from "@/frontend/components/use-join-space";
import { useOpenDeadlines } from "@/frontend/components/use-open-deadlines";
import { cn } from "@/frontend/lib/utils";
import { countLeft, nextCard } from "./home-page-model";
import { CHIP } from "./styles";

/** A narrow card puts the tile above the words as a strip. */
const STRIP = "@max-[539px]:w-full @max-[539px]:flex-row @max-[539px]:items-baseline @max-[539px]:gap-3 @max-[539px]:py-2";
/** The gap form's three keys need more room: under the words, beside the tile, until the card is
 *  960 wide, then at the row's end. */
const GAP_ROW = "@min-[540px]:grid @min-[540px]:grid-cols-[auto_minmax(0,1fr)] @min-[960px]:grid-cols-[auto_minmax(0,1fr)_auto] @min-[960px]:items-center";
const GAP_BLOCK = `${STRIP} @min-[540px]:row-span-2 @min-[960px]:row-span-1`;

/**
 * Now, the biggest card on Home: the deadline picked in the week (the
 * next thing to do until one is picked). Its tile, flush with the card's
 * left edge as on a space's Deadlines list, holds the time left (or how
 * late it is) in its space's color. Beside it its name as the title (which
 * opens its page) with one line under it, and at the row's end, on the
 * title's center line, "Mark done" and the page's one main key. One ticked
 * done today shows the Done stamp and its name struck through, with Undo
 * and no main key.
 */
export function NextCard({
	deadline: d,
	progress,
	color,
	nowMs,
	busyOn,
	onStart,
	onDone,
	onUndo,
}: {
	deadline: OpenDeadline;
	progress: DeadlineProgress | undefined;
	color: SpaceColor | undefined;
	nowMs: number;
	/** The id of the lesson start in flight, if any. */
	busyOn: string | null;
	onStart: (d: OpenDeadline) => void;
	onDone: (d: OpenDeadline) => void;
	onUndo: (d: OpenDeadline) => void;
}) {
	const words = nextCard(d, progress, nowMs);
	// The ids its key starts under: the deadline, its homework, or the session it goes on from.
	const starting = busyOn !== null && [d.id, homeworkStartId(d.id), progress?.continueStudy?.chatId].includes(busyOn);
	return (
		<CardFrame
			testid="today-card"
			target={`deadline:${d.id}`}
			block={d.done ? <DoneBlock className={cn("w-[112px] self-stretch py-2", STRIP)} /> : <CountBlock size="card" color={blockColor(color)} {...countLeft(dueAtMs(d), nowMs)} className={STRIP} />}
			struck={d.done}
			title={
				<Link to={deadlineHref(d.id)} data-testid="today-card-open" className="hover:underline">
					{words.title}
				</Link>
			}
			line={
				<>
					{words.line}
					{words.ready && (
						<span data-testid="today-card-ready" className={cn(CHIP, "ml-3 align-[1px]")}>
							{words.ready}
						</span>
					)}
				</>
			}
		>
			{words.button ? (
				<>
					<button type="button" data-testid="today-done" onClick={() => onDone(d)} className="lh-btn lh-btn-quiet">
						Mark done
					</button>
					<Key data-testid="today-start" busy={starting} disabled={busyOn !== null} onClick={() => onStart(d)} className={MAIN_KEY}>
						{words.button}
					</Key>
				</>
			) : (
				<button type="button" data-testid="today-undo" onClick={() => onUndo(d)} className="lh-btn lh-btn-quiet">
					Undo
				</button>
			)}
		</CardFrame>
	);
}

/**
 * The card's other form: an outline picked in the week, a deadline that
 * looks missing, drawn as its outline in dashes of its space's color. Its
 * days left where a deadline's are, with no fill, its name as the title
 * and the server's line under it. Its keys hand the teacher "Update
 * {space}", open the space's Add a deadline filled in, and wave it off;
 * with no teacher to ask, "Add it myself" is the main key.
 */
export function NextGap({ gap, color, spaceName, nowMs }: { gap: RhythmGap; color: SpaceColor | undefined; spaceName: string; nowMs: number }) {
	const teacher = useTeacher();
	const { answerGap } = useOpenDeadlines();
	const openInSpace = useOpenInSpace();
	const answering = useGuardedAction();
	const asks = teacher?.canAsk ? teacher : null;
	return (
		<CardFrame
			testid="today-gap"
			outlined
			color={color}
			block={<CountBlock size="card" color={null} {...countLeft(dueAtMs({ date: gap.day }), nowMs)} className={GAP_BLOCK} />}
			title={gap.label}
			line={
				answering.error ? (
					<span role="alert" className="text-ans-wrong">
						{answering.error}
					</span>
				) : (
					gap.line
				)
			}
		>
			<Key data-testid="today-gap-answer" busy={answering.busy} onClick={() => void answering.run(() => answerGap(gap.spaceId, gap.key))} className="lh-btn-quiet">
				{gap.answer}
			</Key>
			<Key data-testid="today-gap-add" disabled={answering.busy} onClick={() => openInSpace(gap.spaceId, addDeadlineHref(seedFromGap(gap)))} className={asks ? undefined : MAIN_KEY}>
				Add it myself
			</Key>
			{asks && (
				<Key data-testid="today-gap-ask" disabled={answering.busy} onClick={() => asks.ask(updateLine(spaceName))} className={MAIN_KEY}>
					Ask {asks.name}
				</Key>
			)}
		</CardFrame>
	);
}

/** The card's shape, the same in both forms: the tile at its left edge, the title with its one
 *  line, the keys at the row's end. `outlined`: the gap form, drawn as its outline in its space's
 *  color with no sheet, its keys under the words while the card is narrow (GAP_ROW). */
function CardFrame({
	testid,
	target,
	outlined = false,
	color,
	block,
	title,
	struck = false,
	line,
	children,
}: {
	testid: string;
	target?: string;
	outlined?: boolean;
	color?: SpaceColor;
	block: ReactNode;
	title: ReactNode;
	/** Ticked done: the title struck through. */
	struck?: boolean;
	line: ReactNode;
	children: ReactNode;
}) {
	const row = (
		<div className={cn("flex min-h-[104px] flex-col", outlined ? GAP_ROW : "@min-[540px]:flex-row @min-[540px]:items-center")}>
			{block}
			{/* The title's ink sits low in its line box, so the words sit 4px high to center on the keys. */}
			<div className={cn("flex min-w-0 flex-1 flex-col gap-1 px-(--lh-inset) pt-3", outlined ? "pb-3 @min-[960px]:pb-5" : "pb-5")}>
				<h2 className={cn("text-[28px] leading-tight break-words text-ink", struck && "line-through")}>{title}</h2>
				<p data-testid="today-card-line" className="text-[17px] leading-snug text-ink-2">
					{line}
				</p>
			</div>
			<span className={cn("flex shrink-0 flex-wrap items-center gap-3 px-(--lh-inset) pb-5", outlined ? "@min-[960px]:py-4 @min-[960px]:pl-0" : "@min-[540px]:py-4 @min-[540px]:pl-0")}>{children}</span>
		</div>
	);
	return outlined ? (
		// The sheet's lip is kept as room, so the card is as tall in both forms and the page holds still.
		<section data-testid={testid} style={{ "--lh-dash": color && spaceLineColor(color) } as CSSProperties} className="lh-dashed @container relative border-b-4 border-transparent">
			{row}
		</section>
	) : (
		<Pane data-testid={testid} data-teacher-target={target} className="@container overflow-hidden">
			{row}
		</Pane>
	);
}
