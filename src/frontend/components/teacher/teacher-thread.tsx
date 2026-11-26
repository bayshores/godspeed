import type { CSSProperties, ReactNode, Ref } from "react";
import { CitedResponse } from "@/frontend/components/citations/cited-response";
import { LearnerPlate } from "@/frontend/components/lesson/learner-plate";
import type { Arrive } from "@/frontend/components/lesson/arrivals";
import { cn } from "@/frontend/lib/utils";

/** One line of a thread. */
export interface ThreadLine {
	key: string;
	who: "you" | "teacher";
	/** The learner's words (plain text) or the teacher's (markdown and math). */
	text: string;
	/** The teacher's words being written now: the writing mark stands at their end. */
	writing?: boolean;
	/** Over the learner's words: what they were about (the part of a cheat sheet pointed at). */
	over?: ReactNode;
	/** Under the words: the learner's files, or the teacher's notes (a version made, a rule saved). */
	under?: ReactNode;
}

/** Both speakers' words in the reading type at 16 points. */
const THREAD_TYPE = { "--lh-prose-size": "16px", "--lh-prose-leading": "1.5" } as CSSProperties;

/**
 * A thread between the learner and the teacher, oldest first: the learner's lines on plates at the
 * right (LearnerPlate), the teacher's lying open in the reading type. `live` lies under the newest
 * line: the desk, the cards waiting to be allowed, the lines typed while the teacher works, an
 * error row. The teacher panel's chat and the cheat sheet's chat both draw this, so the two never
 * look or act differently. A learner's line that comes while the thread is shown steps in (`arrive`).
 *
 * `exchange`: the newest exchange (the learner's newest line and all under it) gets a section of
 * its own, as tall as the scrolling room around it says (--lh-thread-room), so a new line can glide
 * to the top.
 */
export function TeacherThread({ lines, live, arrive, exchange }: { lines: readonly ThreadLine[]; live?: ReactNode; arrive: Arrive; exchange?: Ref<HTMLElement> }) {
	const lastYou = exchange ? lines.findLastIndex((line) => line.who === "you") : -1;
	const before = lastYou === -1 ? lines : lines.slice(0, lastYou);
	const newest = lastYou === -1 ? [] : lines.slice(lastYou);
	const draw = (line: ThreadLine, i: number) => <ThreadRow key={line.key} line={line} arrived={!!arrive(`${i}:${line.who}`)} />;
	return (
		<div data-testid="teacher-thread" className="flex min-w-0 flex-col gap-3.5" style={THREAD_TYPE}>
			{before.map(draw)}
			{lastYou === -1 ? (
				live
			) : (
				<section ref={exchange} data-fills="room for the newest exchange to reach the top" className="flex min-h-(--lh-thread-room) min-w-0 flex-col gap-3.5">
					{newest.map((line, i) => draw(line, lastYou + i))}
					{live}
				</section>
			)}
		</div>
	);
}

function ThreadRow({ line, arrived }: { line: ThreadLine; arrived: boolean }) {
	if (line.who === "you")
		return (
			<LearnerPlate text={line.text} over={line.over} className={cn("my-0", arrived && "lh-block-in")}>
				{line.under}
			</LearnerPlate>
		);
	return (
		<div data-testid="thread-teacher" className="flex min-w-0 flex-col gap-2">
			{line.text && (
				<div className="min-w-0 font-prose break-words text-ink">
					<CitedResponse text={line.text} isAnimating={line.writing} className={line.writing ? "lh-streaming" : undefined} />
				</div>
			)}
			{line.under}
		</div>
	);
}
