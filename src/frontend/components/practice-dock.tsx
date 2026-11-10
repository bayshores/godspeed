import { useEffect, useRef, useState } from "react";
import { ToolContentResponse } from "@/frontend/components/ai-elements/message";
import { useEnterSubmits } from "@/frontend/components/enter-submits";
import { HeaderChip, PanelBody, PanelHeader, SendButton, StopButton } from "@/frontend/components/lesson/panel-parts";
import { TurnStatus } from "@/frontend/components/lesson/turn-status";
import { MathBox } from "@/frontend/components/math-box";
import { AttachButton, AttachmentTray, attachmentInputProps, useAttachmentDraft } from "@/frontend/components/lesson/attachment-tray";
import { restoreUnsent } from "@/frontend/components/lesson/chat-helpers";
import type { ChatAttachment } from "@/shared/core";

/**
 * THE PRACTICE PANEL: an active problem fills
 * the Your-turn panel: the statement's opening (the whole problem is the
 * card in the lesson, which "show the whole problem" scrolls to) and the
 * thinking box with one Send (Enter sends, Shift+Enter is a newline).
 * Whether a submission claims an answer is read from the thinking by the
 * agent; one problem may take many submissions, each starting a turn.
 *
 * The commitment (modelSolution, …) rides the call's arguments and never
 * renders here — only the statement is the learner's. Discard problem
 * (and Esc, through the page's layered-Esc chain) opens the discard confirm.
 */
interface PracticeDockProps {
	/** The active problem's tool-call id (submissions target it). */
	problemCallId: string;
	/** The pose's arguments — only the statement is the learner's. */
	input: { statement: string };
	/** text and files — POST {type:"thinking"} (one lane). Resolves false
	 *  when the send was not taken. */
	onSubmit: (text: string, attachments: ChatAttachment[]) => Promise<boolean>;
	/** A turn is running: a send now would be dropped, so the field keeps its text. */
	busy?: boolean;
	/** The running turn waits on the outside agent (the header says so). */
	waitingForAgent?: boolean;
	/** Compaction is running: the POST would block on the server's gate. */
	compactionRunning?: boolean;
	/** A quiet row under the field (the lesson's stats). */
	footer?: React.ReactNode;
	/** The thinking as the learner left it (this problem's saved draft). */
	initialDraft?: string;
	/** Called with the unsent thinking on every change, so it survives leaving the lesson. */
	onSaveDraft?: (thinking: string) => void;
	/** Opens the discard confirm. */
	onDiscard?: () => void;
	/** Scrolls the lesson to the problem's card, for a statement too long to show here. */
	onShowProblem?: () => void;
	/** Stops the running turn (shown while it runs). */
	onStop?: () => void;
}

export function PracticeDock({
	problemCallId,
	input,
	onSubmit,
	busy = false,
	waitingForAgent = false,
	compactionRunning = false,
	footer,
	initialDraft = "",
	onSaveDraft,
	onDiscard,
	onShowProblem,
	onStop,
}: PracticeDockProps) {
	const [thinking, setThinking] = useState(initialDraft);
	// The ref mirrors the field: the window-level Enter reads the current trace.
	const thinkingRef = useRef(initialDraft);
	const attachments = useAttachmentDraft(problemCallId);
	const empty = thinking.trim().length === 0 && attachments.files.length === 0;

	const submit = () => {
		if (compactionRunning || busy) return;
		const text = thinkingRef.current.trim();
		const drafts = attachments.files;
		const files = drafts.map((f) => f.attachment);
		if (text.length === 0 && files.length === 0) return;
		thinkingRef.current = "";
		setThinking("");
		onSaveDraft?.("");
		attachments.clear();
		void onSubmit(text, files).then((sent) => {
			if (sent) return;
			thinkingRef.current = restoreUnsent(text, thinkingRef.current);
			setThinking(thinkingRef.current);
			onSaveDraft?.(thinkingRef.current);
			attachments.restore(drafts);
		});
	};

	// Enter submits from anywhere outside a typing surface.
	useEnterSubmits(submit);
	const statementRef = useRef<HTMLDivElement>(null);
	const statementOverflows = useOverflows(statementRef);

	return (
		<form
			data-testid="practice-dock"
			data-problem={problemCallId}
			className="flex min-h-0 flex-1 flex-col"
			onSubmit={(e) => {
				e.preventDefault();
				submit();
			}}
			{...attachmentInputProps(attachments)}
		>
			<PanelBody>
				<PanelHeader
					status={busy && <TurnStatus waitingForAgent={waitingForAgent} />}
					right={
						<HeaderChip exit={onDiscard && { label: "Discard problem", testId: "discard-problem", onClick: onDiscard }}>
							{busy && onStop && <StopButton onStop={onStop} />}
						</HeaderChip>
					}
				/>
				{/* The statement's opening: the whole problem stays in the wide lesson
				    column, so the work box keeps the panel. A longer one fades out. */}
				<div
					ref={statementRef}
					data-testid="practice-statement"
					data-overflow={statementOverflows || undefined}
					className="lh-edge-fade max-h-36 shrink-0 overflow-hidden py-3 font-bold text-ink"
					style={{ "--lh-prose-size": "18px", "--lh-prose-leading": `${25 / 18}`, "--lh-ink-body": "var(--foreground)" } as React.CSSProperties}
				>
					<ToolContentResponse>{input.statement}</ToolContentResponse>
				</div>
				{statementOverflows && onShowProblem && (
					<button type="button" data-testid="show-problem" onClick={onShowProblem} className="lh-press lh-btn ml-auto shrink-0">
						show the whole problem
					</button>
				)}
				<div data-testid="practice-thinking-field" className="mt-3 flex min-h-40 flex-1 flex-col">
					<AttachmentTray draft={attachments} />
					<MathBox
						value={thinking}
						onChange={(v) => {
							thinkingRef.current = v;
							setThinking(v);
							onSaveDraft?.(v);
						}}
						onEnter={submit}
						placeholder="Work here, think out loud."
						ariaLabel="Your thinking"
						footer={
							<>
								<AttachButton draft={attachments} />
								<SendButton
									type="submit"
									testId="practice-send"
									label={compactionRunning ? "Summarizing the lesson…" : "Send"}
									disabled={empty || compactionRunning || busy}
								/>
							</>
						}
					/>
				</div>
				{footer}
			</PanelBody>
		</form>
	);
}

/** Whether the element's content is taller than the element, kept current. */
function useOverflows(ref: React.RefObject<HTMLElement | null>): boolean {
	const [overflows, setOverflows] = useState(false);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		for (const child of el.children) ro.observe(child);
		return () => ro.disconnect();
	}, [ref]);
	return overflows;
}
