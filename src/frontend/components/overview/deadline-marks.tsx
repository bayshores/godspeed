import { rampColor, type DeadlineProgress } from "@/shared/core";
import { StepBlocks } from "./lesson-rows";

/** How far a deadline is, drawn as blocks: a homework's problems, done ones
 *  inked, or its topics, weakest first, each in its ramp color. */
export function DeadlineMarks({ deadline: d }: { deadline: Pick<DeadlineProgress, "problems" | "topics"> }) {
	if (d.problems) return <StepBlocks done={d.problems.done} total={d.problems.total} />;
	if (d.topics.length === 0) return null;
	return (
		<span aria-hidden className="flex flex-wrap gap-[3px]">
			{d.topics.map((t) => (
				<span key={t.id} title={t.name} className="size-3" style={{ background: rampColor(t.rate) }} />
			))}
		</span>
	);
}
