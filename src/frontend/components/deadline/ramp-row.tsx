import { rampColor } from "@/shared/core";
import { rightLabel, type TopicTally } from "./deadline-model";

/** A topic's ramp square, name and answers so far: a row of a deadline's
 *  Path sheet and of a space's path. */
export function RampRow({ name, rate, tally }: { name: string; rate: number | null; tally: Pick<TopicTally, "right" | "hinted" | "answered"> | undefined }) {
	return (
		<span className="flex min-w-0 items-center gap-2">
			<span className="size-2.5 shrink-0" style={{ background: rampColor(rate) }} aria-hidden />
			<span title={name} className="min-w-0 flex-1 truncate text-[15px] text-ink">
				{name}
			</span>
			{(tally?.answered ?? 0) > 0 && <span className="shrink-0 text-base text-ink-2">{rightLabel(tally)}</span>}
		</span>
	);
}
