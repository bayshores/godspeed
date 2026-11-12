import type { Phase3 } from "@/shared/core";

/**
 * The transcript's phase boundary: a dotted rule with the phase's name at
 * the message where the session enters a new phase, drawn by
 * lesson/message-row.tsx. It is a message-level seam, not part of a tool part.
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
			<span className="h-0 flex-1 border-t-2 border-dotted border-edge" aria-hidden />
			<span className="text-sm text-ink-2">{PHASE_LABEL[phase]}</span>
			<span className="h-0 flex-1 border-t-2 border-dotted border-edge" aria-hidden />
		</div>
	);
}
