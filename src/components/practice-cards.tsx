import { ToolContentResponse } from "@/components/ai-elements/message";
import { cn } from "@/lib/utils";
import type { ArtifactPartProps } from "@/core";

/**
 * The practice transcript cards: three quiet records in the stream —
 *
 * - ProblemCard — a posed problem: the statement, compact-expandable
 *   (like every card here; the dock is the working surface, this is the
 *   record). The commitment NEVER renders — only the call's statement.
 * - ConcludeCard — the conclusion: outcome badge + verdict + the reveal
 *   (the committed solution, shown when the problem ended). A dismissal
 *   synthesis (outcome:"dismissed") renders as one muted line.
 * - ThinkingCard — the learner's own submission, user-side: the register
 *   is the two buttons' (Nudge = working trace, Commit = answer). The
 *   unified ThinkingBlock: the quiz quote-block language in a faint
 *   user-side shell, never collapsible.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ThinkingBlock } from "@/components/thinking-block";
import { usePopoverDismiss } from "@/components/popover-dismiss";
import { usePresence } from "@/components/presence";
import { classQuery, useClasses } from "@/components/class-context";

/* TARGET NAMES: targets are normalized to opaque node ids at the record
 * seam (the mastery trace groups on them), so the drawer resolves names
 * at render time. One lazy cached fetch of the graph view per class
 * graph (the class the window shows); failures degrade to raw ids, so
 * observability never breaks the card. */
const nodeNameMapPromises = new Map<string, Promise<Record<string, string>>>();
function nodeNameMap(classId: string | null): Promise<Record<string, string>> {
	const key = classId ?? "none";
	const cached = nodeNameMapPromises.get(key);
	if (cached) return cached;
	const nodeNameMapPromise = fetch(`/api/graph${classQuery(classId)}`)
		.then((r) => (r.ok ? r.json() : { nodes: [] }))
		.then((g: { nodes?: Array<{ id?: unknown; name?: unknown }> }) =>
			Object.fromEntries(
				(g.nodes ?? [])
					.filter((n) => typeof n.id === "string")
					.map((n) => [n.id as string, typeof n.name === "string" ? (n.name as string) : (n.id as string)]),
			),
		)
		.catch(() => ({}));
	nodeNameMapPromises.set(key, nodeNameMapPromise);
	return nodeNameMapPromise;
}

/** The practice-thinking marker's details (native-messages.ts). */
export interface PracticeThinkingData {
	problemCallId: string;
	/** Old records carry a two-lane flag; ignored. */
	commit?: boolean;
	text: string;
}

export function ProblemCard({ part }: ArtifactPartProps) {
	// Always open, no chevron: the record IS the statement, in the same
	// container + eyebrow as the answered card and the dock. The
	// commitment never renders, only the call's statement.
	const input = (part.input ?? {}) as { statement?: string };
	const statement = typeof input.statement === "string" ? input.statement : "";
	return (
		<div data-testid="problem-card" className="my-1 border bg-card p-4">
			<div className="mb-1 text-xs font-semibold text-muted-foreground">Problem</div>
			<div className="lh-prose text-[15px]">
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

/* The outcome chips: the EXACT register of the
 * quiz cards' correct/incorrect bubbles. Colors per outcome — solved reads
 * green (the "correct" twin), solved-with-hints amber (succeeded with
 * cost), surrendered red (the problem beat the learner), moved on muted
 * (the agent's call, not a verdict against him). */
const OUTCOME_CHIP: Record<string, string> = {
	solved: "bg-green-500/15 text-green-500",
	solvedWithHints: "bg-amber-500/15 text-amber-500",
	movedOn: "bg-muted text-muted-foreground",
	surrendered: "bg-red-500/15 text-red-500",
	dismissed: "bg-muted text-muted-foreground",
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
			<div data-testid="conclude-card" className="my-1 px-1 text-sm text-muted-foreground/70">
				Problem dismissed.
			</div>
		);
	}

	return (
		<div data-testid="conclude-card" className="relative my-1 border bg-card p-4">
			{/* The heading row: plain 'Concluded' eyebrow + the outcome in the
			    quiz cards' chip register. */}
			<div className="mb-1 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
				Concluded
				{(OUTCOME_LABEL[outcome] ?? "") !== "" && outcome !== "dismissed" && (
					<span className={cn(" px-1.5 py-0.5", OUTCOME_CHIP[outcome] ?? OUTCOME_CHIP.movedOn)}>
						{OUTCOME_LABEL[outcome]}
					</span>
				)}
			</div>
			{/* The verdict: plain prose under the heading, no 'Verdict:' label,
			    in the same quiet 50% register as quiz explanations. */}
			{verdict.length > 0 && (
				<div className="text-sm text-foreground/50">
					<ToolContentResponse>{verdict}</ToolContentResponse>
				</div>
			)}
			{/* Then the divider, then the labeled model solution (the pose's
			    commitment, verbatim). */}
			{reveal.length > 0 && (
				<>
					<div className="my-3 border-t" />
					<div>
						<div className="mb-0.5 text-xs font-semibold text-muted-foreground">Model solution</div>
						<div className="lh-prose text-[15px]">
							<ToolContentResponse>{reveal}</ToolContentResponse>
						</div>
					</div>
				</>
			)}
			<MetadataPopover
				concludeInput={input}
				problemInput={(part.problemInput ?? {}) as { mode?: unknown; target?: unknown }}
			/>
		</div>
	);
}

/* THE METADATA POPOVER: a quiet METADATA trigger at the bottom of the
 * conclude card opens the graph-view node-card info box, always BELOW the
 * trigger; any scroll or click outside closes it (plus Esc). Shows every
 * field the agent filled in both the problem call (mode, targets, names
 * resolved lazily) and the conclude call (outcome, rung, miss class,
 * retest). Statement and modelSolution stay out: they are the visible
 * card. Small register: text-xs rows, mono values. */
function MetadataPopover({
	concludeInput,
	problemInput,
}: {
	concludeInput: { outcome?: string; rung?: unknown; missClass?: unknown; retest?: unknown };
	problemInput: { mode?: unknown; target?: unknown };
}) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const rootRef = useRef<HTMLDivElement | null>(null);
	// The portal's anchor: the box is placed from
	// the trigger's viewport rect AT OPEN TIME — any scroll closes the
	// box, so there is nothing to track.
	const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
	const [names, setNames] = useState<Record<string, string> | null>(null);
	const { active: activeClassId } = useClasses();
	const targets = Array.isArray(problemInput.target)
		? problemInput.target.filter((t): t is string => typeof t === "string")
		: [];
	// Resolve names only when there is something to resolve.
	useEffect(() => {
		if (!open || targets.length === 0 || names) return;
		let alive = true;
		void nodeNameMap(activeClassId).then((m) => {
			if (alive) setNames(m);
		});
		return () => {
			alive = false;
		};
	}, [open, targets.length, names]);

	usePopoverDismiss(rootRef, open, () => setOpen(false));
	// The box fades out before unmounting.
	const box = usePresence(open);
	// ANY scroll closes it: capture-phase, so every scroller
	// in the tree counts — the transcript's own scroll included.
	useEffect(() => {
		if (!open) return;
		const close = () => setOpen(false);
		window.addEventListener("scroll", close, { capture: true, passive: true });
		return () => window.removeEventListener("scroll", close, { capture: true });
	}, [open]);

	const mode = typeof problemInput.mode === "string" ? problemInput.mode : "";
	const rung = typeof concludeInput.rung === "string" ? concludeInput.rung : "";
	const miss = typeof concludeInput.missClass === "string" ? concludeInput.missClass : "";
	const retest = typeof concludeInput.retest === "boolean" ? concludeInput.retest : undefined;
	const outcome = typeof concludeInput.outcome === "string" ? concludeInput.outcome : "";
	if (!mode && targets.length === 0 && !rung && !miss && retest === undefined) return null;

	return (
		<div ref={rootRef} className="relative mt-3">
			<button
				type="button"
				data-testid="metadata-toggle"
				ref={triggerRef}
				onClick={() => {
					setOpen((v) => {
						if (v) return false;
						const r = triggerRef.current?.getBoundingClientRect();
						if (r) {
							// Below the trigger, always; clamped so the 320px box
							// never leaves the viewport's right edge.
							const left = Math.max(8, Math.min(r.left, window.innerWidth - 328));
							setAnchor({ top: r.bottom + 8, left });
						}
						return true;
					});
				}}
				aria-expanded={open}
				className="lh-press flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
			>
				Metadata
			</button>
			{box.mounted &&
				anchor &&
				createPortal(
					<div
						data-testid="metadata-box"
						data-state={box.state}
						// PORTALED TO BODY: the transcript's MessageContent boxes
						// carry overflow-hidden, so an absolutely positioned child
						// would clip at its message block's edge. A fixed-position
						// portal sits on top of everything, like the dialogs.
						style={{ position: "fixed", top: anchor.top, left: anchor.left }}
						className="lh-pop z-50 lh-glass w-80 max-w-[calc(100vw-1rem)] p-4 text-left"
					>
				<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
						<dt className="text-muted-foreground">Mode</dt>
						<dd className="font-mono">{mode || "–"}</dd>
						<dt className="text-muted-foreground">Targets</dt>
						<dd className="font-mono">
							{targets.length === 0 ? (
								"untagged"
							) : (
								<span>
									{targets.map((t, i) => (
										<span key={t}>
											{i > 0 && ", "}
											{names?.[t] ?? t}
										</span>
									))}
								</span>
							)}
						</dd>
						<dt className="text-muted-foreground">Outcome</dt>
						<dd className="font-mono">{outcome || "–"}</dd>
						<dt className="text-muted-foreground">Hint rung</dt>
						<dd className="font-mono">{rung || "none"}</dd>
						<dt className="text-muted-foreground">Miss class</dt>
						<dd className="font-mono">{miss || "none"}</dd>
						<dt className="text-muted-foreground">Retest</dt>
						<dd className="font-mono">{retest === undefined ? "–" : retest ? "yes" : "no"}</dd>
					</dl>
					</div>,
					document.body,
				)}
		</div>
	);
}

export function ThinkingCard({ data }: { data: PracticeThinkingData }) {
	// One style, one label: 50%-italic quote block. Old records' commit
	// flag is deliberately unread (one lane). A transcript row: full-width
	// band + rail, arriving expanded.
	return <ThinkingBlock testId="thinking-card" label="YOUR THINKING" text={data.text} defaultOpen />;
}
