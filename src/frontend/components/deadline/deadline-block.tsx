import { dueAtMs } from "@/frontend/components/countdown-model";
import { isOverdue } from "@/frontend/components/deadlines-model";
import { countLeft } from "@/frontend/components/home-page/home-page-model";
import { CountBlock } from "@/frontend/components/ui/count-block";
import { Stamp } from "@/frontend/components/ui/stamp";
import { useJustDone } from "@/frontend/components/use-open-deadlines";
import { cn } from "@/frontend/lib/utils";

const GREY = "flex shrink-0 items-center justify-center bg-[color-mix(in_srgb,var(--border)_50%,var(--card))]";
const BOX = { list: "w-24 self-stretch", head: "min-h-[120px] w-[120px] self-stretch" };

/** A done deadline's block: the Done stamp on grey, printed when it was ticked just now (`fresh`). */
export function DoneBlock({ className, fresh }: { className: string; fresh: boolean }) {
	return (
		<span className={cn(GREY, className)}>
			<Stamp fresh={fresh}>Done</Stamp>
		</span>
	);
}

/**
 * A deadline's block: the time left on the space's color, the Done stamp,
 * or "was due" once it passed.
 */
export function DeadlineBlock({
	deadline: d,
	color,
	nowMs,
	size,
	pale,
}: {
	deadline: { id: string; date: string; time?: string; done: boolean };
	/** The space's color. */
	color: string;
	nowMs: number;
	/** A row of the Deadlines list, or the head of the deadline's page. */
	size: keyof typeof BOX;
	pale?: boolean;
}) {
	const justDone = useJustDone(d.id);
	if (d.done) return <DoneBlock className={BOX[size]} fresh={justDone} />;
	if (isOverdue(d, nowMs)) return <span className={cn(GREY, BOX[size], "font-count text-ui text-ink")}>was due</span>;
	return <CountBlock size={size} pale={pale} color={color} {...countLeft(dueAtMs(d), nowMs)} />;
}
