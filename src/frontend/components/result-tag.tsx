import { cn } from "@/frontend/lib/utils";

/** The colored word on a card: how an answer or a problem ended. */
const TONES = {
	right: "bg-(--lh-space-3) text-on-space",
	hints: "bg-(--lh-space-5) text-on-space",
	wrong: "bg-(--lh-space-4) text-on-space",
	plain: "bg-tone-2 text-ink",
} as const;

export type ResultTone = keyof typeof TONES;

export function ResultTag({ tone, testId, children }: { tone: ResultTone; testId?: string; children: string }) {
	return (
		<span data-testid={testId} className={cn("inline-block shrink-0 rounded-sm px-[9px] py-0.5 text-sm font-medium", TONES[tone])}>
			{children}
		</span>
	);
}
