import { useContext, useLayoutEffect, useMemo, type Ref } from "react";
import { ChatActionsContext } from "@/frontend/components/chat-actions-context";
import { ConversationEmptyState } from "@/frontend/components/ai-elements/conversation";
import { QueuedSteersBody, type QueuedSteerLine } from "@/frontend/components/queued-steers";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { spaceColorVar } from "@/frontend/components/space-color";
import { useSpaceColor } from "@/frontend/components/space-context";
import { cn } from "@/frontend/lib/utils";
import { DEFAULT_TEACHER_NAME, type LessonWork, type LhViewMessage, type Phase3 } from "@/shared/core";
import { AgentAtWork } from "./agent-at-work";
import { ArrivalRow, type Arrive } from "./arrivals";
import { MessageRow, messageShows } from "./message-row";
import { stepSheets, type SheetRow } from "./step-sheets-model";
import { useDesk } from "./use-desk";

/**
 * THE READING PANE: the lesson text in the reading type, answered cards
 * inline, one sheet per step (stepSheets) with the step's number on a tab at
 * its left edge. A sheet is as tall as its text and the newest fills the
 * window; the page around them scrolls (LessonScroll).
 * While the teacher works, the newest sheet holds the desk (AgentAtWork, useDesk): what the
 * teacher does, its steps and the files it reads, with the lines typed to it that wait under it;
 * Stop and the keys that move the lesson on are in "Your turn". Its words take the desk's place
 * and grow as they are written, with the waiting lines under them.
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
	/** Lines typed to the teacher that wait for its reply to end. */
	queuedSteers: QueuedSteerLine[];
	arrivalsLive: boolean;
	/** Each Study topic's stored page mark, by the text it sits in. */
	pageMarks: ReadonlyMap<string, string>;
	arrive: Arrive;
	/** Told whether the desk is in the text, also while it leaves. */
	onDesk: (up: boolean) => void;
	/** The newest sheet, for the lesson page's glide (useSheetGlide). */
	sheetRef?: Ref<HTMLElement>;
}) {
	const last = messages.length - 1;
	const { wrote, desk: shownDesk, closing, shown } = useDesk(messages, busy, work, useTeacher()?.name ?? DEFAULT_TEACHER_NAME);
	const deskUp = shownDesk !== null;
	useLayoutEffect(() => onDesk(deskUp), [deskUp, onDesk]);
	const foot = (busy || closing) && <QueuedSteersBody steers={queuedSteers} />;
	const actions = useContext(ChatActionsContext);
	const inTurn = actions?.inTurn ?? null;
	const spaceColor = useSpaceColor(spaceId);
	// A row or a sheet with nothing drawn on it is left out; with no sheet drawn, the newest still stands for the desk.
	const sheets = useMemo(() => {
		const rowShows = ({ index, from, to }: SheetRow) => {
			const m = shown[index]!;
			if (from === 0 && teachSeam(shown, phases, index)) return true;
			return messageShows(to - from === m.parts.length ? m : { ...m, parts: m.parts.slice(from, to) }, index === echo, inTurn);
		};
		const all = stepSheets(shown, stepNumbers).map((sheet) => ({ ...sheet, rows: sheet.rows.filter(rowShows) }));
		const drawn = all.filter((sheet) => sheet.rows.length > 0);
		return drawn.length > 0 ? drawn : all.slice(-1);
	}, [shown, stepNumbers, phases, echo, inTurn]);
	return (
		<div data-testid="lesson-reading" data-session-find-root="" data-turn-wrote={(busy && wrote) || undefined} className={cn("lh-text-sheets flex min-w-0 flex-col gap-10", deskUp && "flex-1")}>
			{sheets.map((sheet, si) => {
				const newest = si === sheets.length - 1;
				const first = sheet.rows[0];
				return (
					<section key={first ? `${shown[first.index]!.id || first.index}:${first.from}` : "empty"} ref={newest ? sheetRef : undefined} data-testid="lesson-sheet" className={cn("flex min-w-0 flex-col gap-4", newest && deskUp && "flex-1")}>
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
								const m = shown[mi]!;
								return (
									<MessageRow
										key={m.id || `m-${mi}`}
										message={m}
										index={mi}
										echo={mi === echo}
										teachSeam={teachSeam(shown, phases, mi)}
										streamingLast={status === "streaming" && mi === last}
										hiddenCalls={shownDesk && mi === shown.length - 1 ? shownDesk.calls : null}
										pageMarks={pageMarks}
										arrive={arrive}
										from={from}
										to={to}
									/>
								);
							})}
							{newest && shownDesk && (
								<ArrivalRow live={arrivalsLive} className="flex flex-1 flex-col">
									<div data-state={closing ? "closed" : "open"} data-desk-closing={closing || undefined} inert={closing} className={cn("flex flex-1 flex-col", closing && "lh-fade")}>
										<AgentAtWork chatId={actions?.chatId ?? ""} head={shownDesk.head} work={shownDesk.work} arrive={arrive} foot={foot} />
									</div>
								</ArrivalRow>
							)}
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

