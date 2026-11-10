import { enterAction } from "./enter-action";
import { QueuedSteersBody, type QueuedSteerLine } from "@/frontend/components/queued-steers";
import { SendButton, StopButton } from "./panel-parts";
import { MathBox } from "@/frontend/components/math-box";
import { AttachButton, AttachmentTray, attachmentInputProps, type AttachmentDraft } from "./attachment-tray";

/**
 * The lesson's one message box, at the foot of the reading pane. It never
 * moves: with a question or problem open, a message is a side question and
 * the question stays open; otherwise it is a plain lesson message. While
 * the teacher writes, typed text steers the turn ("Send when ready") and
 * an empty box holds Stop.
 *
 * Enter follows enterAction: send (or steer) when there is text, stop on an
 * empty box while the teacher writes, and in a practice pause an empty
 * Enter asks for the next problem.
 */
export function LessonBox({
	busy,
	value,
	onChange,
	onSend,
	onStop,
	canSend,
	showStop,
	sideOpen,
	nextReady,
	onNext,
	queuedSteers,
	attachments,
	notice,
}: {
	busy: boolean;
	value: string;
	onChange: (v: string) => void;
	onSend: () => void;
	onStop: () => void;
	canSend: boolean;
	/** The running turn's Stop lives here (not in a problem's dock). */
	showStop: boolean;
	/** What is open in the Your turn panel; messages to it are side questions. */
	sideOpen: "question" | "problem" | null;
	/** The pause between problems: an empty Enter asks for the next one. */
	nextReady: boolean;
	onNext: () => void;
	queuedSteers: QueuedSteerLine[];
	attachments: AttachmentDraft;
	/** A line above the box (the stuck-turn notice). */
	notice?: React.ReactNode;
}) {
	const act = () => {
		const action = enterAction({ busy, canSend, nextProblem: nextReady, hasFiles: attachments.files.length > 0 });
		if (action === "stop") onStop();
		else if (action === "send") onSend();
		else if (action === "next") onNext();
	};
	const steering = busy && sideOpen === null;
	return (
		<form
			data-testid="composer"
			className="flex shrink-0 flex-col gap-2 px-6 pt-2 pb-4"
			onSubmit={(e) => {
				e.preventDefault();
				act();
			}}
			{...attachmentInputProps(attachments)}
		>
			{notice}
			{queuedSteers.length > 0 && <QueuedSteersBody steers={queuedSteers} />}
			<AttachmentTray draft={attachments} note={steering ? "Send pictures after the teacher finishes" : undefined} />
			<div className="flex items-end gap-1 border border-tone-2 bg-background p-0.5 has-[.cm-focused]:border-ink-2">
				<AttachButton draft={attachments} />
				<div className="flex min-w-0 flex-1 flex-col self-stretch">
					{/* Enter sends, Shift+Enter is a newline, ⌘/Ctrl+Enter sends too. */}
					<MathBox compact value={value} onChange={onChange} onEnter={act} placeholder="Message the teacher…" ariaLabel="Message the teacher" />
				</div>
				<div className="flex h-9 items-center pr-1">
					{busy && showStop && !canSend ? (
						<StopButton onStop={onStop} />
					) : (
						<SendButton type="submit" testId="composer-send" label={busy ? "Send when ready" : "Send"} waiting={busy} disabled={!canSend} />
					)}
				</div>
			</div>
			{sideOpen && (
				<p data-testid="side-question-note" className="text-sm leading-5 text-ink-3">
					Your {sideOpen} stays open while you ask.
				</p>
			)}
		</form>
	);
}
