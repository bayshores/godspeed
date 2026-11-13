/**
 * When a Study lesson asks the review route for a question from earlier:
 * once when the lesson opens, whatever is open, so a reload shows the one
 * he asked the teacher about; then while it waits on its teacher or its
 * agent, with nothing open, nothing shown and no answer or skip on its
 * way. The key changes when a turn starts or ends, so each one asks again:
 * with no agent connected the lesson waits the whole time, and Keep going
 * at a stop opens the server's window only once its go-ahead starts a
 * turn. Null: no ask. Pure.
 */
export function fromEarlierAsk(s: {
	/** The lesson has not asked yet. */
	first: boolean;
	/** A Study lesson waiting on its teacher or its agent. */
	waiting: boolean;
	/** The teacher's question or a problem is open. */
	open: boolean;
	/** A question from earlier is on screen. */
	shown: boolean;
	/** An answer or a skip is on its way. */
	sending: boolean;
	/** A turn runs. */
	busy: boolean;
}): "first" | "turn" | "no turn" | null {
	if (s.shown || s.sending) return null;
	if (s.first) return "first";
	if (!s.waiting || s.open) return null;
	return s.busy ? "turn" : "no turn";
}
