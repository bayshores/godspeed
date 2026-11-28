import { useEffect } from "react";
import { dueAtMs } from "@/frontend/components/countdown-model";
import { isOverdue } from "@/frontend/components/deadlines-model";
import { countLeft } from "@/frontend/components/home-page/home-page-model";
import { useTurnedOn } from "@/frontend/components/lesson/arrivals";
import { useSound } from "@/frontend/components/sounds";
import { CountBlock } from "@/frontend/components/ui/count-block";
import { Stamp } from "@/frontend/components/ui/stamp";
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

/** Whether the deadline was ticked done while in sight, which is when its stamp prints and the done sound plays. */
export function useJustDone(d: { id: string; done: boolean } | null): boolean {
	const justDone = useTurnedOn(!!d?.done, d?.id);
	const play = useSound();
	useEffect(() => {
		if (justDone) play("done");
	}, [justDone, play]);
	return justDone;
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
	const justDone = useJustDone(d);
	if (d.done) return <DoneBlock className={BOX[size]} fresh={justDone} />;
	if (isOverdue(d, nowMs)) return <span className={cn(GREY, BOX[size], "font-count text-ui text-ink")}>was due</span>;
	return <CountBlock size={size} pale={pale} color={color} {...countLeft(dueAtMs(d), nowMs)} />;
}
