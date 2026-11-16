/**
 * THE QUEUED-STEER INDICATOR: lines typed to the teacher while it writes,
 * not yet drained, render as quiet one-liners at the foot of the lesson
 * text above Stop, truncated with an ellipsis, no background, no
 * container. Visible but quiet.
 *
 * A line dies the moment its card lands in the transcript: the drain's
 * verbatim message events upsert the real user card by the client-minted
 * id, and visibleQueuedSteers (session-core, pure) filters the queue
 * against the message ids. A steer parked server-side (stranded behind a
 * question) keeps its line — an honest "waiting for the next run".
 */
export interface QueuedSteerLine {
	id: string;
	text: string;
}

/** The pure body (SSR-pinnable): one truncated line per queued steer, stacked. */
export function QueuedSteersBody({ steers }: { steers: QueuedSteerLine[] }) {
	if (steers.length === 0) return null;
	return (
		<div className="flex flex-col gap-0.5" data-testid="queued-steers">
			{steers.map((s) => (
				<span
					key={s.id}
					title={s.text}
					className="lh-rise block max-w-[240px] truncate font-prose text-[15px] text-ink-2"
				>
					{s.text}
				</span>
			))}
		</div>
	);
}
