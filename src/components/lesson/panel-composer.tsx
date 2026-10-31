import { SquareIcon } from "lucide-react";
import { enterAction } from "./enter-action";
import { QueuedSteersBody, type QueuedSteerLine } from "@/components/queued-steers";
import { cn } from "@/lib/utils";
import { ActionBar, PANEL_FIELD, PanelBody, PanelHeader, PanelHeaderButton } from "./panel-parts";
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
					eyebrow={!busy ? "Your turn" : waitingForAgent ? "Waiting for your agent" : "Teacher is writing…"}
					right={
						busy && (
							<PanelHeaderButton testId="stop-turn" onClick={onStop}>
								<SquareIcon aria-hidden className="size-3" />
								Stop
							</PanelHeaderButton>
						)
					}
				/>
				{busy && <div className="pt-3 text-sm leading-5 text-ink-2">Sends when the teacher finishes.</div>}
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
