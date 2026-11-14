import { MessageResponse } from "@/frontend/components/ai-elements/message";
import { Pane } from "@/frontend/components/ui/pane";
import type { About } from "./use-deadline-about";
import { RULE, SHEET, SHEET_TITLE } from "./styles";

/** The teacher's Markdown; its headings stay under the sheet's title. */
const ABOUT_TEXT = "font-prose text-[17px] leading-relaxed text-ink [--lh-heading-weight:500] [&_:is(h1,h2,h3)]:text-lg [&_:is(h1,h2,h3)]:leading-snug";

/**
 * WHAT IT'S LIKE: what the teacher wrote about the deadline (its file
 * "What it's like.md"), as Markdown, and a quiet way to ask for it again.
 */
export function AboutSheet({ about, teacherName, onAsk, onRetry }: { about: About; teacherName: string; onAsk: () => void; onRetry: () => void }) {
	return (
		<Pane data-testid="deadline-about" className={SHEET}>
			<h2 className={SHEET_TITLE}>What it&apos;s like</h2>
			<span className={RULE} />
			{about.state === "ready" ? (
				<div data-testid="deadline-about-text" className={ABOUT_TEXT}>
					<MessageResponse>{about.text}</MessageResponse>
				</div>
			) : about.state === "failed" ? (
				<div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
					<p className="min-w-0 flex-1 text-[17px] text-ink">Couldn&apos;t load what it&apos;s like.</p>
					<button type="button" data-testid="deadline-about-retry" onClick={onRetry} className="lh-btn text-[15px]">
						Try again
					</button>
				</div>
			) : (
				<div className="h-24 w-full bg-tone" aria-hidden />
			)}
			<button type="button" data-testid="deadline-about-ask" onClick={onAsk} className="lh-btn lh-btn-quiet -ml-1 self-start text-[15px]">
				Ask {teacherName} to rewrite
			</button>
		</Pane>
	);
}
