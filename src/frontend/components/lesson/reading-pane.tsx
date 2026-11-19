import { useContext, useMemo } from "react";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { ConversationEmptyState } from "@/frontend/components/ai-elements/conversation";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { QueuedSteersBody, type QueuedSteerLine } from "@/frontend/components/queued-steers";
import { JobsContext } from "@/frontend/components/jobs-context";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { noAgentHere, useTerminals } from "@/frontend/components/terminal/use-terminals";
import { useLastWhileClosing } from "@/frontend/components/ui/dialog-sheet";
import { StartAgentAction } from "@/frontend/components/work/start-agent-action";
import { cn } from "@/frontend/lib/utils";
import type { LhViewMessage, Phase3 } from "@/shared/core";
import { AgentAtWork } from "./agent-at-work";
import { agentWork } from "./agent-at-work-model";
import { ArrivalRow, type Arrive } from "./arrivals";
import { GoAheadKey } from "./go-ahead-key";
import { MessageRow } from "./message-row";
import { cardFiles, deskMark, deskPaper, heldBack, nothingWritten, titleEcho, waitView } from "./wait-model";

/**
 * THE READING PANE: the lesson as one document on the lesson text's sheet, in
 * the reading type, answered cards inline. The sheet is as tall as its
 * text; the page around it scrolls (LessonScroll).
 * Its foot holds one thing at a time: while the teacher works, the desk
 * (AgentAtWork), which grows to the sheet's foot, with Stop under it; once it
 * has finished, the go-ahead key,
 * if the lesson waits for one. When the reply lands the desk fades out first
 * and the reply is held back until it has gone, so the two never stack.
 * Each message is a memoized row, so streaming redraws only the message
 * being written.
 */
export function ReadingPane({
	spaceId,
	title,
	assignment,
	messages,
	phases,
	status,
	busy,
	waitingForAgent,
	onStop,
	onStartAgain,
	goAhead,
	queuedSteers,
	arrivalsLive,
	pageMarks,
	arrive,
}: {
	/** The lesson's space. */
	spaceId: string | undefined;
	/** The lesson's title: a first message that only repeats it shows no bubble. */
	title: string;
	/** A homework lesson's assignment file: the top sheet on the desk. */
	assignment: { path: string | null } | null;
	messages: readonly LhViewMessage[];
	/** The phase at every message (phaseTimeline). */
	phases: readonly Phase3[];
	status: "ready" | "submitted" | "streaming" | "error";
	busy: boolean;
	/** The turn waits for an agent to take it: the pill says so, and the desk lies still. */
	waitingForAgent: boolean;
	/** Stops the running turn; null while the teacher reads ahead at a stop, which is not stopped. */
	onStop: (() => void) | null;
	/** Runs the lesson's turn again after a stop left it with nothing from the teacher; null after an error, whose line has Try again. */
	onStartAgain: (() => void) | null;
	/** The key that moves the lesson on ("Next problem", "Continue", "Start problem 3"); null when none waits. */
	goAhead: { label: string; onGo: () => void } | null;
	/** Lines typed to the teacher that wait for its reply to end. */
	queuedSteers: QueuedSteerLine[];
	arrivalsLive: boolean;
	/** Each Study topic's stored page mark, by the text it sits in. */
	pageMarks: ReadonlyMap<string, string>;
	arrive: Arrive;
}) {
	const last = messages.length - 1;
	const jobs = useContext(JobsContext);
	// The reply being worked on: its plan, steps and file, until its text lands.
	const replying = busy && messages[last]?.role === "assistant" ? messages[last] : undefined;
	const work = useMemo(() => (replying ? agentWork(replying, jobs, cardFiles(messages)) : null), [replying, jobs, messages]);
	const view = waitView({ busy, waitingForAgent, work });
	const open = useMemo(
		() => view.desk && { state: view.desk, split: view.split, work, paper: deskPaper(messages, assignment), mark: deskMark(messages) },
		[view.desk, view.split, work, messages, assignment],
	);
	const desk = useLastWhileClosing(open);
	const closing = desk.mounted && desk.state === "closed" && !prefersReducedMotion();
	const shownDesk = open || (closing ? desk.shown : null);
	const shown = closing && desk.shown ? heldBack(messages, desk.shown.mark) : messages;
	const echo = titleEcho(messages, title);
	const foot = (busy || closing) && onStop && (
		<div className="flex flex-col items-start gap-2 font-ui">
			<QueuedSteersBody steers={queuedSteers} />
			<div className="flex flex-wrap items-center gap-3">
				{shownDesk?.state === "waiting" && <StartKey />}
				<button type="button" data-testid="stop-turn" onClick={onStop} className="lh-btn lh-btn-quiet">
					Stop
				</button>
			</div>
		</div>
	);
	const startAgain = !busy && !shownDesk && !goAhead && nothingWritten(messages) ? onStartAgain : null;
	return (
		<div data-session-find-root="" className="lh-reading flex flex-1 flex-col gap-4">
			{messages.length === 0 && !busy && <ConversationEmptyState title="New lesson" description="" />}
			{shown.map((m, mi) => (
				<MessageRow
					key={m.id || `m-${mi}`}
					message={m}
					spaceId={spaceId}
					index={mi}
					echo={mi === echo}
					// The inferred teach seam: teaching begins at the group where
					// the phase fold flips to teach (exactly one per lesson).
					teachSeam={m.role === "assistant" && mi > 0 && phases[mi] === "teach" && phases[mi - 1] !== "teach"}
					streamingLast={status === "streaming" && mi === last}
					hideSteps={!!shownDesk && mi === shown.length - 1}
					pageMarks={pageMarks}
					arrive={arrive}
				/>
			))}
			{shownDesk && (
				<ArrivalRow live={arrivalsLive} className="flex flex-1 flex-col">
					<div data-state={closing ? "closed" : "open"} data-desk-closing={closing || undefined} inert={closing} className={cn("flex flex-1 flex-col", closing && "lh-fade")}>
						<AgentAtWork state={shownDesk.state} work={shownDesk.work} split={shownDesk.split} paper={shownDesk.paper} arrive={arrive} foot={foot} />
					</div>
				</ArrivalRow>
			)}
			{!shownDesk && foot}
			{!shownDesk && goAhead && <GoAheadKey label={goAhead.label} onGo={goAhead.onGo} />}
			{startAgain && <GoAheadKey label="Start again" onGo={startAgain} />}
		</div>
	);
}

/** While the turn waits for an agent: the key that turns the teacher on, when none is here and
 *  godspeed is not starting one by itself, and the teacher's panel does not show its own. */
function StartKey() {
	const status = useAgentStatus();
	const terminals = useTerminals();
	const panelStarts = useTeacher()?.panelStarts ?? false;
	if (!noAgentHere(status, terminals) || terminals?.waking || panelStarts) return null;
	return <StartAgentAction />;
}
