import { CitedResponse } from "@/frontend/components/citations/cited-response";

/** A stretch of the teacher's text in the lesson, with its sources. While it streams, an unclosed
 *  diagram fence shows "still drawing", not a doomed parse. */
export function ReplyPassage({
	id,
	sourceId,
	text,
	page,
	streaming,
}: {
	/** The anchor the lesson's navigation jumps to. */
	id?: string;
	sourceId?: string;
	text: string;
	/** The topic's stored page mark this text draws the page of. */
	page?: string;
	streaming: boolean;
}) {
	return (
		<div id={id} data-source-message-id={sourceId} className="lh-source-passage">
			<CitedResponse text={text} page={page} isAnimating={streaming} className={streaming ? "lh-streaming" : undefined} />
		</div>
	);
}
