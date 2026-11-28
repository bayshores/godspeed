import { cn } from "@/frontend/lib/utils";

/** The colored word on a card: how an answer or a problem ended, in the status colors, which each
 *  background (and a pop-up) makes readable. Hints sit midway on the ramp from wrong to right. */
const TONES = {
	right: "bg-ans-right text-background",
	hints: "bg-(--lh-ramp-3) text-background",
	wrong: "bg-ans-wrong text-background",
	plain: "bg-tone-2 text-ink",
} as const;

export type ResultTone = keyof typeof TONES;

export function ResultTag({ tone, testId, children }: { tone: ResultTone; testId?: string; children: string }) {
	return (
		<span data-testid={testId} className={cn("inline-block shrink-0 lh-notch px-[9px] py-0.5 text-sm font-medium", TONES[tone])}>
			{children}
		</span>
	);
}
