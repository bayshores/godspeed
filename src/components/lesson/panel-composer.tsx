import { SquareIcon } from "lucide-react";
import { enterAction } from "./enter-action";
import { QueuedSteersBody, type QueuedSteerLine } from "@/components/queued-steers";
import { cn } from "@/lib/utils";
import { ActionBar, PANEL_FIELD, PanelBody, PanelHeader } from "./panel-parts";

/**
 * The Your-turn panel with no question waiting (redesign, your-turn
 * states): a message box and Send. While the teacher writes, the header
 * says so with Stop · Esc, and the bar turns gray — "Send when ready":
 * a message typed now steers the running turn and shows as a queued line
 * until it lands in the lesson.
 *
 * Enter follows enterAction: send (or steer) when
 * there is text, stop on an empty box while the teacher writes, and in a
 * practice pause an empty Enter asks for the next problem.
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
	/** A line under the box (the "Waiting for your agent" notice). */
	notice?: React.ReactNode;
	footer?: React.ReactNode;
}) {
	const act = () => {
		const action = enterAction({ busy, canSend, nextProblem });
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
		>
			<PanelBody>
				<PanelHeader
					eyebrow={busy ? "Teacher is writing…" : "Your turn"}
					right={
						busy && (
							<button
								type="button"
								data-testid="stop-turn"
								aria-label="Stop"
								onClick={onStop}
								className="lh-press lh-fade flex shrink-0 items-center gap-1.5 bg-tone px-2 py-[3px] text-[12.5px] font-bold text-ink-2 hover:text-ink"
							>
								<SquareIcon aria-hidden className="size-3" />
								Stop
								<span className="font-mono text-xs font-normal text-ink-3">Esc</span>
							</button>
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
					placeholder={nextProblem ? "Ask anything, or press Enter for the next one." : "Message the teacher…"}
					aria-label="Message the teacher"
					className={cn(PANEL_FIELD, busy ? "mt-4" : "mt-3")}
				/>
				{footer}
			</PanelBody>
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
		</form>
	);
}
