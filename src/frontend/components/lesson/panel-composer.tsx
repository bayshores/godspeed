import { useState } from "react";
import { ArrowUpIcon } from "lucide-react";
import { Pane } from "@/frontend/components/ui/pane";
import { enterAction } from "./enter-action";
import { QueuedSteersBody, type QueuedSteerLine } from "@/frontend/components/queued-steers";
import { cn } from "@/frontend/lib/utils";
import { PanelBody, PanelHeader, SendButton, StopButton } from "./panel-parts";
import { MathBox } from "@/frontend/components/math-box";
import { TurnStatus } from "./turn-status";
import { AttachButton, AttachmentTray, attachmentInputProps, type AttachmentDraft } from "./attachment-tray";

/**
 * The Your-turn panel with no question waiting: a message box (the writing
 * box, where math formats as you type) and Send.
 * While the teacher writes, the header says so with a Stop button, and the bar turns gray:
 * "Send when ready". A message typed now steers the running turn and
 * shows as a queued line until it lands in the lesson.
 *
 * Enter follows enterAction: send (or steer) when
 * there is text, stop on an empty box while the teacher writes, and in a
 * practice pause an empty Enter asks for the next problem.
 *
 * Pictures and PDFs wait above the box. A steer is text only, so while the
 * teacher writes they stay put and Send waits.
 */
export function PanelComposer({
	busy,
	value,
	onChange,
	onSend,
	onStop,
	canSend,
	next,
	onNext,
	queuedSteers,
	attachments,
	waitingForAgent = false,
	notice,
	footer,
}: {
	busy: boolean;
	value: string;
	onChange: (v: string) => void;
	onSend: () => void;
	onStop: () => void;
	canSend: boolean;
	/** The go-ahead button's label in the pause between problems ("Next
	 *  problem", or "Continue" in a study session, where a topic may be
	 *  taught first); absent outside that pause. */
	next?: string;
	onNext?: () => void;
	queuedSteers: QueuedSteerLine[];
	attachments: AttachmentDraft;
	/** The turn waits for an agent to take it: the header says so instead of "Teacher is writing…". */
	waitingForAgent?: boolean;
	/** A line under the header (the stuck-turn notice). */
	notice?: React.ReactNode;
	footer?: React.ReactNode;
}) {
	const act = () => {
		const action = enterAction({ busy, canSend, nextProblem: next !== undefined, hasFiles: attachments.files.length > 0 });
		if (action === "stop") onStop();
		else if (action === "send") onSend();
		else if (action === "next") onNext?.();
	};
	const showNext = next !== undefined && !busy && !canSend;
	return (
		<form
			data-testid="composer"
			className="flex min-h-0 flex-1 flex-col"
			onSubmit={(e) => {
				e.preventDefault();
				act();
			}}
			{...attachmentInputProps(attachments)}
		>
			<PanelBody>
				<PanelHeader
					status={busy && <TurnStatus waitingForAgent={waitingForAgent} />}
					right={busy && <StopButton onStop={onStop} />}
				/>
				{notice && <div className="pt-3">{notice}</div>}
				{queuedSteers.length > 0 && (
					<div className="pt-3">
						<QueuedSteersBody steers={queuedSteers} />
					</div>
				)}
				<AttachmentTray draft={attachments} note={busy ? "Send pictures after the teacher finishes" : undefined} />
				<div className={cn("flex flex-1 flex-col", busy ? "mt-4" : "mt-3")}>
					{/* Enter sends, Shift+Enter is a newline, ⌘/Ctrl+Enter sends too. */}
					<MathBox
						value={value}
						onChange={onChange}
						onEnter={act}
						placeholder={next !== undefined ? "Ask anything, or go on to the next problem." : "Message the teacher…"}
						ariaLabel="Message the teacher"
						footer={
							<>
								<AttachButton draft={attachments} />
								{showNext ? (
									<SendButton type="submit" testId="next-problem-button" label={next} />
								) : (
									<SendButton type="submit" testId="composer-send" label={busy ? "Send when ready" : "Send"} waiting={busy} disabled={!canSend} />
								)}
							</>
						}
					/>
				</div>
				{footer}
			</PanelBody>
		</form>
	);
}

/**
 * The message box in compact form, under a waiting question or practice
 * problem: the learner asks the teacher something on the side and the
 * question or problem stays. Pictures
 * and PDFs wait above it as in the message box; while the teacher replies,
 * Send becomes Stop. It is its own pane at the foot of the column, waiting
 * behind "› ask a side question" so the question gets the room, and stays
 * open while there's a draft or a reply.
 */
export function SideQuestionBox({
	busy,
	value,
	onChange,
	onSend,
	onStop,
	canSend,
	attachments,
}: Pick<React.ComponentProps<typeof PanelComposer>, "busy" | "value" | "onChange" | "onSend" | "onStop" | "canSend" | "attachments">) {
	const [opened, setOpened] = useState(false);
	const send = () => {
		if (!canSend) return;
		onSend();
		setOpened(false);
	};
	if (!opened && !busy && !value.trim() && attachments.files.length === 0 && !attachments.error)
		return (
			<Pane data-testid="side-question" className="shrink-0" {...attachmentInputProps(attachments)}>
				<button
					type="button"
					data-testid="side-question-open"
					onClick={() => setOpened(true)}
					className="flex h-12 w-full items-center gap-[1ch] px-4 text-left text-base text-ink-3 hover:bg-tone hover:text-ink"
				>
					<span aria-hidden className="text-tint">
						›
					</span>
					ask a side question
				</button>
			</Pane>
		);
	return (
		<Pane name="side question" active data-testid="side-question" className="shrink-0 px-4 pt-1 pb-3" {...attachmentInputProps(attachments)}>
			<AttachmentTray draft={attachments} />
			<div className="mt-3 flex items-end gap-1 border border-tone-2 bg-background p-0.5 has-[.cm-focused]:border-ink-2">
				<AttachButton draft={attachments} />
				<div
					className="flex min-w-0 flex-1 flex-col self-stretch"
					onBlur={(e) => {
						if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !value.trim()) setOpened(false);
					}}
				>
					<MathBox
						compact
						value={value}
						onChange={onChange}
						onEnter={send}
						// Opened by the link: the learner is about to type.
						autoFocus={opened}
						placeholder="Ask the teacher something"
						ariaLabel="Ask the teacher something"
					/>
				</div>
				{busy ? (
					<div className="flex h-9 items-center">
						<StopButton onStop={onStop} />
					</div>
				) : (
					<button
						type="button"
						data-testid="side-question-send"
						aria-label="Send"
						onClick={send}
						disabled={!canSend}
						className="lh-press flex size-9 shrink-0 items-center justify-center bg-ink text-background hover:bg-ink-max disabled:cursor-default disabled:bg-transparent disabled:text-ink-3"
					>
						<ArrowUpIcon aria-hidden className="size-4" />
					</button>
				)}
			</div>
		</Pane>
	);
}
