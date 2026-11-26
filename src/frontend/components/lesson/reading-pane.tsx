import { useContext, useLayoutEffect, useMemo, useRef, type Ref, type RefObject } from "react";
import { ChatActionsContext } from "@/frontend/components/chat-actions-context";
import { ConversationEmptyState } from "@/frontend/components/ai-elements/conversation";
import { EASE_OUT, prefersReducedMotion } from "@/frontend/components/presence";
import { QueuedSteersBody, type QueuedSteerLine } from "@/frontend/components/queued-steers";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { spaceColorVar } from "@/frontend/components/space-color";
import { useSpaceColor } from "@/frontend/components/space-context";
import { travelGlideMs } from "@/frontend/components/sheet-glide-model";
import { cn } from "@/frontend/lib/utils";
import { DEFAULT_TEACHER_NAME, type LessonWork, type LhViewMessage, type Phase3 } from "@/shared/core";
import { AgentAtWork } from "./agent-at-work";
import { ArrivalRow, type Arrive } from "./arrivals";
import { MessageRow, messageShows } from "./message-row";
import { stepSheets, type SheetRow } from "./step-sheets-model";
import { DeskRoomContext } from "./turn-place";
import { useDesk } from "./use-desk";
import { deskPaper } from "./wait-model";

/**
 * THE READING PANE: the lesson text in the reading type, answered cards
 * inline, one sheet per step (stepSheets) with the step's number on a tab at
 * its left edge. A sheet is as tall as its text and the newest fills the
 * window; the page around them scrolls (LessonScroll).
 * While the teacher works, the desk stands under the newest sheet (AgentAtWork, useDesk): what the
 * teacher does, its steps and the files it reads, with the lines typed to it that wait under it;
 * Stop and the keys that move the lesson on are in "Your turn". Its words grow over the desk as
 * they are written, and the desk stays until the reply is finished. With room for both and the
 * book shut, the desk's steps rest on the writing row at the page's right (DeskRoomContext) and
 * its page stays under the words.
 * Each message is a memoized row, so streaming redraws only the message
 * being written.
 */
export function ReadingPane({
	spaceId,
	stepNumbers,
	stepNames,
	echo,
	messages,
	phases,
	status,
	busy,
	stoppedEmpty,
	work,
	problemSheet,
	queuedSteers,
	arrivalsLive,
	pageMarks,
	arrive,
	onDesk,
	sheetRef,
}: {
	/** The lesson's space. */
	spaceId: string | undefined;
	/** The plan's step numbers by plan node, for the sheets' tabs. */
	stepNumbers: ReadonlyMap<string, number>;
	/** Each plan step's name, by its id. */
	stepNames: ReadonlyMap<string, string>;
	/** The index of the learner's first message when it only repeats the lesson's title (titleEcho): it shows no bubble. */
	echo: number;
	messages: readonly LhViewMessage[];
	/** The phase at every message (phaseTimeline). */
	phases: readonly Phase3[];
	status: "ready" | "submitted" | "streaming" | "error";
	busy: boolean;
	/** The first reply was stopped with nothing written, and no turn or error line is up. */
	stoppedEmpty: boolean;
	/** What the teacher does in the running turn (useLessonWork). */
	work: LessonWork;
	/** The page shows the open problem's sheet beside the text or over it: the desk lays no paper of
	 *  its own and takes no blank room, so the text rests on the writing row. */
	problemSheet: boolean;
	/** Lines typed to the teacher that wait for its reply to end. */
	queuedSteers: QueuedSteerLine[];
	arrivalsLive: boolean;
	/** Each Study topic's stored page mark, by the text it sits in. */
	pageMarks: ReadonlyMap<string, string>;
	arrive: Arrive;
	/** Told whether the desk is in the text, also while it leaves, and whether it lays the page it
	 *  reads there (never beside the open problem's sheet). */
	onDesk: (up: boolean, page: boolean) => void;
	/** The newest sheet, for the lesson page's glide (useSheetGlide). */
	sheetRef?: Ref<HTMLElement>;
}) {
	const last = messages.length - 1;
	const { wrote, desk: shownDesk, closing } = useDesk(messages, busy, work, useTeacher()?.name ?? DEFAULT_TEACHER_NAME);
	const deskUp = shownDesk !== null;
	const deskPage = shownDesk !== null && !problemSheet && deskPaper(shownDesk.work) !== null;
	useLayoutEffect(() => onDesk(deskUp, deskPage), [deskUp, deskPage, onDesk]);
	const room = useContext(DeskRoomContext);
	const foot = (busy || closing) && <QueuedSteersBody steers={queuedSteers} />;
	const actions = useContext(ChatActionsContext);
	const inTurn = actions?.inTurn ?? null;
	const spaceColor = useSpaceColor(spaceId);
	// A row or a sheet with nothing drawn on it is left out; with no sheet drawn, the newest still stands for the desk.
	const sheets = useMemo(() => {
		const rowShows = ({ index, from, to }: SheetRow) => {
			const m = messages[index]!;
			if (from === 0 && teachSeam(messages, phases, index)) return true;
			return messageShows(to - from === m.parts.length ? m : { ...m, parts: m.parts.slice(from, to) }, index === echo, inTurn);
		};
		const all = stepSheets(messages, stepNumbers).map((sheet) => ({ ...sheet, rows: sheet.rows.filter(rowShows) }));
		const drawn = all.filter((sheet) => sheet.rows.length > 0);
		return drawn.length > 0 ? drawn : all.slice(-1);
	}, [messages, stepNumbers, phases, echo, inTurn]);
	const sheetKey = (rows: readonly SheetRow[]) => (rows[0] ? `${messages[rows[0].index]!.id || rows[0].index}:${rows[0].from}` : "empty");
	const desk = useRef<HTMLDivElement>(null);
	useDeskGlide(desk, sheetKey(sheets.at(-1)?.rows ?? []));
	return (
		<div data-testid="lesson-reading" data-session-find-root="" data-turn-wrote={(busy && wrote) || undefined} className={cn("lh-text-sheets flex min-w-0 flex-col gap-10", deskUp && !problemSheet && "flex-1")}>
			{sheets.map((sheet, si) => {
				const newest = si === sheets.length - 1;
				return (
					<section key={sheetKey(sheet.rows)} ref={newest ? sheetRef : undefined} data-testid="lesson-sheet" className="flex min-w-0 flex-col gap-4">
						{/* With one step on the page the step line already says which it is. */}
						{sheet.label && sheets.length > 1 && (
							<h3 data-testid="sheet-step" className="flex items-center gap-3 text-[18px] leading-7 text-ink-2">
								<span className={STEP_TAB} style={{ background: spaceColor ? spaceColorVar(spaceColor) : "var(--color-ink-2)" }}>
									{sheet.counts === "Problem" ? `Problem ${sheet.label}` : <><span className="sr-only">Step </span>{sheet.label}</>}
								</span>
								{sheet.step !== null && stepNames.get(sheet.step)}
							</h3>
						)}
						<div className="flex flex-1 flex-col gap-4">
							{newest && messages.length === 0 && !busy && <ConversationEmptyState title="New lesson" description="" />}
							{sheet.rows.map(({ index: mi, from, to }) => {
								const m = messages[mi]!;
								return (
									<MessageRow
										key={m.id || `m-${mi}`}
										message={m}
										index={mi}
										echo={mi === echo}
										teachSeam={teachSeam(messages, phases, mi)}
										streamingLast={status === "streaming" && mi === last}
										hiddenCalls={shownDesk && mi === messages.length - 1 ? shownDesk.calls : null}
										pageMarks={pageMarks}
										arrive={arrive}
										from={from}
										to={to}
									/>
								);
							})}
							{newest && stoppedEmpty && (
								<p data-testid="nothing-written" className="font-prose text-ink-2" style={{ fontSize: "var(--lh-prose-size)" }}>
									The reply was stopped before anything was written.
								</p>
							)}
							{newest && !shownDesk && foot}
						</div>
					</section>
				);
			})}
			{/* As close to the newest sheet as its rows are, at the top while it has none, and outside the sheets, so a reply that
			    starts a sheet keeps the desk. */}
			{shownDesk && (
				<ArrivalRow live={arrivalsLive} className={cn("flex flex-col", sheets.at(-1)?.rows.length ? "-mt-6" : "-mt-10", !problemSheet && "flex-1")}>
					<div ref={desk} data-state={closing ? "closed" : "open"} data-desk-closing={closing || undefined} inert={closing} className={cn("flex flex-1 flex-col", closing && "lh-fade")}>
						<AgentAtWork chatId={actions?.chatId ?? ""} head={shownDesk.head} writing={shownDesk.writing} work={shownDesk.work} paper={!problemSheet} room={problemSheet ? null : room} closing={closing} arrive={arrive} foot={foot} />
					</div>
				</ArrivalRow>
			)}
		</div>
	);
}

/** The inferred teach seam: teaching begins at the group where the phase fold flips to teach
 *  (exactly one per lesson), and the row draws the divider. */
function teachSeam(messages: readonly LhViewMessage[], phases: readonly Phase3[], index: number): boolean {
	return messages[index]!.role === "assistant" && index > 0 && phases[index] === "teach" && phases[index - 1] !== "teach";
}

/** The step's number on a block of the space's color, before its name. */
const STEP_TAB = "grid h-7 min-w-9 shrink-0 place-items-center px-2 font-count text-[18px] leading-none text-on-space";

/**
 * The desk under the newest sheet glides to its new place when that sheet is a new one: a reply that starts a sheet of its own,
 * or the reply's sheet drawn anew under the id the server gives it at the turn's end. The sheet glide (useSheetGlide) glides a sheet
 * that grows, and the desk under it with it, but places a sheet it had not seen at once.
 */
function useDeskGlide(desk: RefObject<HTMLElement | null>, newest: string) {
	const last = useRef(newest);
	const from = useRef<number | null>(null);
	const glide = useRef<Animation | null>(null);
	// Where the desk is seen, read while the page is still laid out the old way.
	if (last.current !== newest) {
		last.current = newest;
		from.current = desk.current?.getBoundingClientRect().top ?? null;
	}
	useLayoutEffect(() => {
		const el = desk.current;
		const was = from.current;
		from.current = null;
		if (!el || was === null || prefersReducedMotion() || typeof el.animate !== "function") return;
		glide.current?.cancel();
		const moved = el.getBoundingClientRect().top - was;
		if (moved) glide.current = el.animate([{ transform: `translateY(${-moved}px)` }, { transform: "none" }], { duration: travelGlideMs(moved), easing: EASE_OUT });
	}, [desk, newest]);
}
