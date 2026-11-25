import { MessageResponse } from "@/frontend/components/ai-elements/message";
import { LoadingBox } from "@/frontend/components/loading";
import { Pane } from "@/frontend/components/ui/pane";
import type { About } from "./use-deadline-about";

/** The teacher's Markdown; its headings stay under the sheet's title. */
const ABOUT_TEXT = "font-prose text-[17px] leading-relaxed text-ink [--lh-heading-weight:500] [&_:is(h1,h2,h3)]:text-lg [&_:is(h1,h2,h3)]:leading-snug";

/**
 * WHAT IT'S LIKE: what the teacher wrote about the deadline (its file
 * "What it's like.md"), as Markdown, and a quiet way to ask for it again.
 */
export function AboutSheet({
	about,
	teacherName,
	requesting,
	requestLine,
	onAsk,
	onRetry,
}: {
	about: About;
	teacherName: string;
	/** A request to the agent runs on this deadline. */
	requesting: boolean;
	/** Why the last rewrite changed nothing. */
	requestLine: string | null;
	onAsk: () => void;
	onRetry: () => void;
}) {
	return (
		<Pane data-testid="deadline-about" className="lh-card">
			<div className="lh-card-head">
				<h2 className="lh-card-title">What it&apos;s like</h2>
			</div>
			{about.state === "ready" ? (
				<div data-testid="deadline-about-text" className={ABOUT_TEXT}>
					<MessageResponse>{about.text}</MessageResponse>
				</div>
			) : about.state === "failed" ? (
				<div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
					<p className="min-w-0 flex-1 text-[17px] text-ink">Couldn&apos;t load what it&apos;s like.</p>
					<button type="button" data-testid="deadline-about-retry" onClick={onRetry} className="lh-btn">
						Try again
					</button>
				</div>
			) : (
				<LoadingBox className="h-24 bg-tone" />
			)}
			<button type="button" data-testid="deadline-about-ask" disabled={requesting} onClick={onAsk} className="lh-btn lh-btn-quiet lh-btn-flush self-start">
				Ask {teacherName} to rewrite
			</button>
			{requestLine && (
				<p role="alert" data-testid="deadline-request-line" className="text-[15px] text-ink">
					{requestLine}
				</p>
			)}
		</Pane>
	);
}
