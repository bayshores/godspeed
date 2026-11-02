import { useState } from "react";
import { PlusIcon, SquareIcon } from "lucide-react";
import { enterAction } from "./enter-action";
import { QueuedSteersBody, type QueuedSteerLine } from "@/components/queued-steers";
import { cn } from "@/lib/utils";
import { ActionBar, PANEL_FIELD, PanelBody, PanelHeader, ToneButton, fieldKeys } from "./panel-parts";
import { TurnEyebrow } from "./turn-eyebrow";
import { AttachButton, AttachmentTray, attachmentInputProps, type AttachmentDraft } from "./attachment-tray";

/**
 * The Your-turn panel with no question waiting: a message box and Send.
 * While the teacher writes, the header says so with a Stop button (Esc also stops), and the bar turns gray:
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
	nextProblem = false,
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
	nextProblem?: boolean;
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
		const action = enterAction({ busy, canSend, nextProblem, hasFiles: attachments.files.length > 0 });
		if (action === "stop") onStop();
		else if (action === "send") onSend();
		else if (action === "next") onNext?.();
	};
	const showNext = nextProblem && !busy && !canSend;
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
					eyebrow={<TurnEyebrow busy={busy} waitingForAgent={waitingForAgent} />}
					right={busy && <StopButton onStop={onStop} />}
				/>
				{notice && <div className="pt-3">{notice}</div>}
				{queuedSteers.length > 0 && (
					<div className="pt-3">
						<QueuedSteersBody steers={queuedSteers} />
					</div>
				)}
				<AttachmentTray draft={attachments} note={busy ? "Send pictures after the teacher finishes" : undefined} />
				<textarea
					value={value}
					onChange={(e) => onChange(e.target.value)}
					onKeyDown={(e) => {
						// Enter sends, Shift+Enter is a newline, ⌘/Ctrl+Enter sends too.
						if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
							e.preventDefault();
							act();
						}
					}}
					placeholder={nextProblem ? "Ask anything, or go on to the next problem." : "Message the teacher…"}
					aria-label="Message the teacher"
					className={cn(PANEL_FIELD, busy ? "mt-4" : "mt-3")}
				/>
				{footer}
			</PanelBody>
			<div className="flex shrink-0">
				<AttachButton draft={attachments} />
				<div className="min-w-0 flex-1">
					{showNext ? (
						<ActionBar type="submit" testId="next-problem-button" label="Next problem" />
					) : (
						<ActionBar
							type="submit"
							testId="composer-send"
							label={busy ? "Send when ready" : "Send"}
							waiting={busy}
							disabled={!canSend}
						/>
					)}
				</div>
			</div>
		</form>
	);
}

/** Stops the running turn (Esc does too). */
function StopButton({ onStop }: { onStop: () => void }) {
	return (
		<ToneButton testId="stop-turn" onClick={onStop}>
			<SquareIcon aria-hidden className="size-3" />
			Stop
		</ToneButton>
	);
}

/**
 * The message box in compact form, under a waiting question: the learner
 * asks the teacher something on the side and the question stays. Text
 * only; while the teacher replies, Send becomes Stop. It waits behind an
 * "Ask a side question" link so the question gets the room, and stays open
 * while there's a draft or a reply.
 */
export function SideQuestionBox({
	busy,
	value,
	onChange,
	onSend,
	onStop,
	canSend,
}: Pick<React.ComponentProps<typeof PanelComposer>, "busy" | "value" | "onChange" | "onSend" | "onStop" | "canSend">) {
	const [opened, setOpened] = useState(false);
	const send = () => {
		if (!canSend) return;
		onSend();
		setOpened(false);
	};
	if (!opened && !busy && !value.trim())
		return (
			<div data-testid="side-question" className="shrink-0 px-6 py-2.5">
				<button
					type="button"
					data-testid="side-question-open"
					onClick={() => setOpened(true)}
					className="lh-press flex items-center gap-1.5 text-[13.5px] text-ink-2 hover:text-ink"
				>
					<PlusIcon aria-hidden className="size-3.5" />
					Ask a side question
				</button>
			</div>
		);
	return (
		<div data-testid="side-question" className="shrink-0 px-6 py-3">
			<div className="flex items-end bg-background">
				<textarea
					rows={1}
					value={value}
					disabled={busy}
					// Opened by the link: the learner is about to type.
					autoFocus={opened}
					onChange={(e) => onChange(e.target.value)}
					onKeyDown={(e) => fieldKeys(e, send)}
					onBlur={() => {
						if (!value.trim()) setOpened(false);
					}}
					placeholder="Ask the teacher something"
					aria-label="Ask the teacher something"
					className="lh-input field-sizing-content max-h-32 min-w-0 flex-1 resize-none bg-transparent px-3.5 py-2.5 text-[14px]! leading-5! text-ink outline-none placeholder:text-ink-3 disabled:opacity-50"
				/>
				<div className="p-2">
					{busy ? (
						<StopButton onStop={onStop} />
					) : (
						<ToneButton testId="side-question-send" onClick={send} disabled={!canSend}>
							Send
						</ToneButton>
					)}
				</div>
			</div>
		</div>
	);
}
