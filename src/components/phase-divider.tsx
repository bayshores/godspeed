import type { Phase3 } from "@/core";

/**
 * The transcript's phase boundary: a monochrome dotted rule at the message
 * where the session enters a new phase, drawn by lesson/message-row.tsx.
 * It is a message-level seam, not part of a tool part. The label carries
 * the phase; color would only be decoration since phases only advance.
 */

/** The phases as the learner thinks of them. */
const PHASE_LABEL: Record<Exclude<Phase3, "probe">, string> = {
	plan: "Planning",
	teach: "Teaching",
};

/** Null for probe: it is the start of the transcript, so never a seam. */
export function PhaseDivider({ phase }: { phase: Phase3 }) {
	if (phase === "probe") return null;
	return (
		<div className="my-4 flex w-full items-center gap-3" data-testid={`phase-divider-${phase}`}>
			<span className="h-0 flex-1 border-t-2 border-dotted border-border/50" aria-hidden />
			<span className="border border-border/80 px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
				{PHASE_LABEL[phase]}
			</span>
			<span className="h-0 flex-1 border-t-2 border-dotted border-border/50" aria-hidden />
		</div>
	);
}
