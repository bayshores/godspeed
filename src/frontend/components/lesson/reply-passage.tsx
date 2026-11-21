import { CitedResponse } from "@/frontend/components/citations/cited-response";
import { usePrintIn } from "./use-print-in";

/** A stretch of the teacher's text in the lesson, with its sources. While it streams, an unclosed
 *  diagram fence shows "still drawing", not a doomed parse. One that just `landed` prints line by line. */
export function ReplyPassage({
	id,
	sourceId,
	text,
	page,
	streaming,
	landed,
}: {
	/** The anchor the lesson's navigation jumps to. */
	id?: string;
	sourceId?: string;
	text: string;
	/** The topic's stored page mark this text draws the page of. */
	page?: string;
	streaming: boolean;
	landed: boolean;
}) {
	const print = usePrintIn(landed);
	return (
		<div ref={print} id={id} data-source-message-id={sourceId} className="lh-source-passage">
			<CitedResponse text={text} page={page} isAnimating={streaming} className={streaming ? "lh-streaming" : undefined} />
		</div>
	);
}
