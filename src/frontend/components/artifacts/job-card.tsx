import { DispatchCard } from "@/frontend/components/artifacts/dispatch-card";
import { MessageResponse } from "@/frontend/components/ai-elements/message";
import { CARD } from "@/frontend/components/ui/card-parts";
import { ResultTag } from "@/frontend/components/result-tag";
import { LABEL_TEXT } from "@/frontend/components/ui/label-text";
import { cn } from "@/frontend/lib/utils";
import type { ArtifactPartProps, PdfResult, ResearchResult } from "@/shared/core";

/**
 * The research tool-call box (contracts/jobs.ts "THE ASYNC PROTOCOL" §4).
 *
 * The part's output is the fire-and-forget dispatch ACK — the box itself is
 * the DispatchCard (live status via the chat view's jobs feed; quiet one-liner
 * once delivered). The research brief doesn't render from the tool part:
 * it rides the steer message (the user-role delivery
 * injected after the wake turn) and renders there via ResearchBriefCard.
 */
export function JobCard({ part }: ArtifactPartProps) {
	if (part.state !== "output-available") return null;
	return <DispatchCard toolCallId={part.toolCallId} kind="research" />;
}

/**
 * The pdf dispatch box — the same async-protocol idiom as
 * JobCard: the ack output drives a DispatchCard (live "PDF reader" status
 * via the chat view's jobs feed); the brief itself rides the steer message
 * and renders under the PDF-complete badge in the transcript.
 */
export function PdfJobCard({ part }: ArtifactPartProps) {
	if (part.state !== "output-available") return null;
	return <DispatchCard toolCallId={part.toolCallId} kind="pdf" />;
}

/**
 * The PDF reading brief — markdown body + the consulted-pages
 * line. Exported: the steer card renders it under the PDF-complete badge,
 * the same expand-on-demand idiom as research.
 */
export function PdfBriefCard({ output }: { output: unknown }) {
	const result = output as PdfResult | undefined;
	if (!result || typeof result.brief !== "string") {
		return (
			<div className={cn(CARD, "text-[15px] text-ink-2")}>
				PDF reading completed, but the result could not be displayed.
			</div>
		);
	}
	const failed = result.brief.startsWith("PDF failed");
	// Read = extract/render output entered the loop; consulted = every page
	// incl. search hits (the full audit set — the brief's citations may point
	// there). The ?? fallbacks tolerate pre-split persisted records.
	const readList = result.pagesRead ?? result.pagesConsulted ?? [];
	const consultedList = result.pagesConsulted ?? [];
	return (
		<div className={cn(CARD, "flex flex-col gap-2.5 text-card-foreground")} data-testid="pdf-brief-card">
			<div className="flex items-center gap-2.5">
				<span className={LABEL_TEXT}>PDF brief</span>
				{failed && <ResultTag tone="wrong">failed</ResultTag>}
			</div>
			<div className="[&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
				<MessageResponse>{result.brief}</MessageResponse>
			</div>
			{!failed && readList.length > 0 && (
				<div className="border-t border-border pt-2 text-[15px] text-ink-2">
					Pages read: {readList.join(", ")}
				</div>
			)}
			{!failed && consultedList.length > readList.length && (
				<div className="border-t border-border pt-2 text-[15px] text-ink-2">
					Pages consulted: {consultedList.join(", ")}
				</div>
			)}
		</div>
	);
}

/**
 * The research brief — markdown body + a small source link list. Exported:
 * the steer card (sub-agent result delivery) renders the same artifact.
 */
export function ResearchBriefCard({ output }: { output: unknown }) {
	const result = output as ResearchResult | undefined;
	if (!result || typeof result.brief !== "string") {
		return (
			<div className={cn(CARD, "text-[15px] text-ink-2")}>
				Research completed, but the result could not be displayed.
			</div>
		);
	}
	const failed = result.brief.startsWith("Research failed");
	return (
		<div className={cn(CARD, "flex flex-col gap-2.5 text-card-foreground")} data-testid="research-brief-card">
			<div className="flex items-center gap-2.5">
				<span className={LABEL_TEXT}>Research brief</span>
				{failed && <ResultTag tone="wrong">failed</ResultTag>}
			</div>
			<div className="[&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
				<MessageResponse>{result.brief}</MessageResponse>
			</div>
			{result.sources.length > 0 && (
				<div className="flex flex-col gap-1 border-t border-border pt-2">
					<div className={LABEL_TEXT}>Sources</div>
					<ul className="flex flex-col gap-0.5 text-[15px]">
						{result.sources.map((s) => (
							<li key={s.url} className="truncate">
								<a
									href={s.url}
									target="_blank"
									rel="noopener noreferrer"
									className="text-ink underline underline-offset-2 hover:text-ink-max"
								>
									{s.title}
								</a>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}
