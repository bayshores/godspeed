import { ToolContentResponse } from "@/frontend/components/ai-elements/message";
import { ResultTag, type ResultTone } from "@/frontend/components/result-tag";
import { CARD } from "@/frontend/components/ui/card-parts";
import { LABEL_TEXT } from "@/frontend/components/ui/label-text";
import type { ArtifactPartProps } from "@/shared/core";

/**
 * The practice transcript cards: three quiet records in the stream —
 *
 * - ProblemCard — a posed problem: the statement, compact-expandable
 *   (like every card here; the Your turn panel holds the open problem,
 *   this is the record). The commitment NEVER renders — only the call's
 *   statement.
 * - ConcludeCard — the conclusion: outcome badge + verdict + the reveal
 *   (the committed solution, shown when the problem ended). A dismissal
 *   synthesis (outcome:"dismissed") renders as one muted line.
 * - ThinkingCard — the learner's work on a problem as older lessons
 *   saved it (today it is a plain message). The unified ThinkingBlock:
 *   the quiz quote-block language in a faint user-side shell, never
 *   collapsible.
 */

import { ThinkingBlock } from "@/frontend/components/thinking-block";

/** The practice-thinking marker's details (native-messages.ts). */
export interface PracticeThinkingData {
	problemCallId: string;
	/** Old records carry a two-lane flag; ignored. */
	commit?: boolean;
	text: string;
}

/** A problem or conclusion card: the answered card's look. */
const STACK = `${CARD} my-1 flex flex-col gap-2.5`;

/** The card's statement in Literata 16. */
const PROSE_16 = { "--lh-prose-size": "16px", "--lh-prose-leading": "1.5", "--lh-ink-body": "var(--muted-foreground)" } as React.CSSProperties;

export function ProblemCard({ part }: ArtifactPartProps) {
	// Always open, no chevron: the record IS the statement, in the answered
	// card's container. The commitment never renders, only the call's statement.
	const input = (part.input ?? {}) as { statement?: string };
	const statement = typeof input.statement === "string" ? input.statement : "";
	return (
		<div data-testid="problem-card" data-problem-call={part.toolCallId} className={`${STACK} scroll-mt-4`}>
			<div className="font-count text-[15px] text-ink-2">Problem</div>
			<div className="text-ink-2" style={PROSE_16}>
				<ToolContentResponse>{statement}</ToolContentResponse>
			</div>
		</div>
	);
}

const OUTCOME_LABEL: Record<string, string> = {
	solved: "Solved",
	solvedWithHints: "Solved with hints",
	movedOn: "Moved on",
	surrendered: "Surrendered",
	dismissed: "Dismissed",
};

/* The outcome tags: solved reads green, solved-with-hints yellow, surrendered
 * red (the problem beat the learner), moved on grey (the agent's call, not a
 * verdict against the learner). */
const OUTCOME_TONE: Record<string, ResultTone> = {
	solved: "right",
	solvedWithHints: "hints",
	movedOn: "plain",
	surrendered: "wrong",
	dismissed: "plain",
};

export function ConcludeCard({ part }: ArtifactPartProps) {
	// The SOLUTION is the hero: the modelSolution committed at pose time
	// (part.reveal, the view-seam join), shown verbatim, never re-authored.
	// The verdict sits below in the quiz-explanation register. Old records
	// that carry their own solutionReveal fall back to it.
	const input = (part.input ?? {}) as { outcome?: string; verdict?: string; solutionReveal?: string };
	const outcome = typeof input.outcome === "string" ? input.outcome : "";
	const verdict = typeof input.verdict === "string" ? input.verdict : "";
	const reveal =
		typeof part.reveal === "string" ? part.reveal : typeof input.solutionReveal === "string" ? input.solutionReveal : "";

	// The dismissal synthesis: no verdict, no reveal — one muted line (the
	// learner clicked; the record needs only the fact).
	if (outcome === "dismissed") {
		return (
			<div data-testid="conclude-card" className="my-1 px-1 text-[15px] text-ink-2">
				Problem dismissed.
			</div>
		);
	}

	return (
		<div data-testid="conclude-card" className={`${STACK} relative`}>
			{/* The heading row: the outcome tag, then what the card is. */}
			<div className="flex items-center gap-2.5">
				{(OUTCOME_LABEL[outcome] ?? "") !== "" && <ResultTag tone={OUTCOME_TONE[outcome] ?? "plain"}>{OUTCOME_LABEL[outcome]!}</ResultTag>}
				<span className="font-count text-[15px] text-ink-2">Concluded</span>
			</div>
			{verdict.length > 0 && (
				<div className="text-ink-2" style={PROSE_16}>
					<ToolContentResponse>{verdict}</ToolContentResponse>
				</div>
			)}
			{/* Then a rule, then the labeled model solution (the pose's
			    commitment, verbatim). */}
			{reveal.length > 0 && (
				<>
					<div className="border-t border-border" />
					<div className="flex flex-col gap-1">
						<div className={LABEL_TEXT}>Model solution</div>
						<div className="text-ink" style={{ ...PROSE_16, "--lh-ink-body": "var(--foreground)" } as React.CSSProperties}>
							<ToolContentResponse>{reveal}</ToolContentResponse>
						</div>
					</div>
				</>
			)}
		</div>
	);
}

export function ThinkingCard({ data }: { data: PracticeThinkingData }) {
	// One style, one label: 50%-italic quote block. Old records' commit
	// flag is deliberately unread (one lane). A transcript row: full-width
	// band + rail, arriving expanded.
	return <ThinkingBlock testId="thinking-card" text={data.text} defaultOpen />;
}
