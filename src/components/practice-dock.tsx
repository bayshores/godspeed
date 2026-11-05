import { useRef, useState } from "react";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { useEnterSubmits } from "@/components/enter-submits";
import { ActionBar, HeaderChip, KindChip, PanelBody, PanelHeader, StopButton } from "@/components/lesson/panel-parts";
import { TurnStatus } from "@/components/lesson/turn-status";
import { MathBox } from "@/components/math-box";
import { AttachButton, AttachmentTray, attachmentInputProps, useAttachmentDraft } from "@/components/lesson/attachment-tray";
import { restoreUnsent } from "@/components/lesson/chat-helpers";
import type { ChatAttachment } from "@/core";

/**
 * THE PRACTICE PANEL: an active problem fills
 * the Your-turn panel — "Your turn" with "Problem 3", the statement, and
 * "Your thinking" with one Send (Enter sends, Shift+Enter is a newline).
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
	/** The problem's number in this lesson ("Problem 3"). */
	number?: number | null;
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
	/** Stops the running turn (shown while it runs). */
	onStop?: () => void;
}

export function PracticeDock({
	problemCallId,
	input,
	number,
	onSubmit,
	busy = false,
	waitingForAgent = false,
	compactionRunning = false,
	footer,
	initialDraft = "",
	onSaveDraft,
	onDiscard,
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
							<KindChip testId="problem-number">
								{number ? `Problem ${number}` : "Problem"}
							</KindChip>
						</HeaderChip>
					}
				/>
				<div
					data-session-find-root=""
					data-testid="practice-statement"
					className="mt-3 shrink-0 font-bold text-ink"
					style={{ "--lh-prose-size": "18px", "--lh-prose-leading": `${25 / 18}`, "--lh-ink-body": "var(--foreground)" } as React.CSSProperties}
				>
					<ToolContentResponse>{input.statement}</ToolContentResponse>
				</div>
				<div data-testid="practice-thinking-field" className="mt-5 flex flex-1 flex-col">
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
					/>
				</div>
				{footer}
			</PanelBody>
			<div className="flex shrink-0">
				<AttachButton draft={attachments} />
				<div className="min-w-0 flex-1">
					<ActionBar
						type="submit"
						testId="practice-send"
						label={compactionRunning ? "Summarizing the lesson…" : "Send"}
						disabled={empty || compactionRunning || busy}
					/>
				</div>
			</div>
		</form>
	);
}
