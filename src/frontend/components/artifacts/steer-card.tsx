import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { CARD, SMALL_BTN } from "@/frontend/components/ui/card-parts";
import { cn } from "@/frontend/lib/utils";
import type { PdfResult, ResearchResult, SubagentArtifactData } from "@/shared/core";
import type { LhViewMessage } from "@/shared/core";
import { isSubagentFailure } from "@/shared/core";
import { DemoOutputCard } from "@/frontend/components/artifacts/demo-card";
import { PdfBriefCard, ResearchBriefCard } from "@/frontend/components/artifacts/job-card";
import { VisualOutputCard } from "@/frontend/components/artifacts/visual-card";

/**
 * The sub-agent result delivery card (contracts.ts "THE ASYNC PROTOCOL" §4).
 *
 * When a background job completes, the wake pipeline injects a STEER message
 * into the transcript: a user-role UIMessage whose data part
 * ("data-subagent-artifact") carries the result. It renders as an artifact —
 * NEVER a learner bubble, never wrapped in a message container:
 *
 *   research — a quiet "Research complete" one-liner that expands on demand
 *     (native <details>) to the full persisted brief + sources: the brief is
 *     too long to inline by default and the teacher's wake turn weaves it
 *     into the lesson anyway. Failures keep the failure card (the brief
 *     explains what went wrong).
 *   demo / visual — the artifact itself (sandboxed iframe / sanitized SVG).
 *     The sub-agent's verification notes are model-facing glue and do NOT
 *     render; only a failure note does.
 */
export function SubagentSteerCard({ message }: { message: LhViewMessage }) {
	const artifactPart = message.parts.find((p) => p.type === "data-subagent-artifact");
	const data = artifactPart?.data as SubagentArtifactData | undefined;
	// The abort steer: its message-type part is
	// data-subagent-aborted (the custom-message scheme — the part, not
	// metadata, is the marker) — a quiet chip, mirroring the complete-badge.
	if (!data) {
		const aborted = message.parts.find((p) => p.type === "data-subagent-aborted") as
			| { data?: { kind?: string } }
			| undefined;
		if (aborted?.data) return <AbortedBadge kind={aborted.data.kind ?? "job"} />;
		return (
			<div className={cn(CARD, "text-[15px] text-ink-2")}>
				A sub-agent finished, but its result could not be displayed.
			</div>
		);
	}
	switch (data.kind) {
		case "research":
			return isSubagentFailure("research", data.result as ResearchResult) ? (
				<ResearchBriefCard output={data.result} />
			) : (
				<ResearchCompleteBadge result={data.result as ResearchResult} />
			);
		case "pdf":
			return isSubagentFailure("pdf", data.result as PdfResult) ? (
				<PdfBriefCard output={data.result} />
			) : (
				<PdfCompleteBadge result={data.result as PdfResult} />
			);
		case "demo":
			return <DemoOutputCard output={data.result} messageId={message.id} initialInverted={data.ui?.inverted ?? false} />;
		case "visual":
			return <VisualOutputCard output={data.result} messageId={message.id} initialInverted={data.ui?.inverted ?? false} />;
	}
}

/** The aborted-job chip: mirrors the complete-badge one-liner — the
 * teacher's wake turn acknowledges the abort in the lesson itself,
 * this just marks what happened. */
function AbortedBadge({ kind }: { kind: string }) {
	return (
		<div data-testid="job-aborted-badge" className="flex items-center gap-2.5 text-[15px] text-ink-2">
			<PixelIcon name="close" className="text-ans-wrong" />
			<span className="text-ink">{kind}</span>
			<span>aborted by the learner</span>
		</div>
	);
}

/** One delivered brief: a card with a line (who, how it ended, and a
 * button) that opens to the full brief. The teacher's wake turn weaves the
 * brief into the lesson anyway, so it stays folded until asked for. */
function BriefBadge({ testId, who, ended, children }: { testId: string; who: string; ended: string; children: React.ReactNode }) {
	return (
		<details data-testid={testId} className={cn(CARD, "group w-full py-3")}>
			<summary className="flex cursor-pointer select-none list-none flex-wrap items-center gap-2.5 [&::-webkit-details-marker]:hidden">
				<span className="text-lg text-ink">{who}</span>
				<span className="text-sm text-ink-2">{ended}</span>
				<span className="flex-1" />
				<span className={cn(SMALL_BTN, "inline-flex items-center group-open:hidden")}>View brief</span>
				<span className={cn(SMALL_BTN, "hidden items-center bg-tone-2 group-open:inline-flex")}>Hide brief</span>
			</summary>
			<div className="mt-3">{children}</div>
		</details>
	);
}

function PdfCompleteBadge({ result }: { result: PdfResult }) {
	// The honest count is READ pages (extract/render); the ?? reads older
	// persisted steers that only have pagesConsulted.
	const readPages = result.pagesRead ?? result.pagesConsulted;
	const n = readPages.length;
	return (
		<BriefBadge testId="pdf-complete-badge" who="PDF reader" ended={n > 0 ? `finished, ${n} page${n === 1 ? "" : "s"} read` : "finished"}>
			<PdfBriefCard output={result} />
		</BriefBadge>
	);
}

function ResearchCompleteBadge({ result }: { result: ResearchResult }) {
	const n = result.sources.length;
	return (
		<BriefBadge testId="research-complete-badge" who="Research agent" ended={n > 0 ? `finished, ${n} source${n === 1 ? "" : "s"}` : "finished"}>
			<ResearchBriefCard output={result} />
		</BriefBadge>
	);
}
