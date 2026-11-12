import { useContext } from "react";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { CARD } from "@/frontend/components/ui/card-parts";
import { cn } from "@/frontend/lib/utils";
import { JobsContext } from "@/frontend/components/jobs-context";
import type { JobKind, JobRecord } from "@/shared/core";
import { BrailleSpinner } from "@/frontend/components/braille-spinner";
import { useNow } from "@/frontend/components/use-now";

/**
 * The dispatch card (contracts.ts "THE ASYNC PROTOCOL" §4): the tool-call
 * box for a background sub-agent. The tool part's output is the FIRE-AND-
 * FORGET ACK (a string) — never the result. Live status comes from the
 * chat-view jobs feed via JobsContext, matched by toolCallId:
 *
 *   job unknown → "dispatched" pulse (the jobs feed hasn't seen it yet)
 *   running     → live activity card (activity line + elapsed)
 *   done/error  → quiet one-liner ("finished" / "failed") — the artifact
 *                 itself arrives in the steer message right below, so the
 *                 box must not duplicate it.
 */
const KIND_LABEL: Record<JobKind, string> = {
	research: "Research agent",
	demo: "Demo agent",
	visual: "Figure agent",
	pdf: "PDF reader",
};

export function DispatchCard({ toolCallId, kind }: { toolCallId: string; kind: JobKind }) {
	const jobs = useContext(JobsContext);
	const job = jobs.find((j) => j.toolCallId === toolCallId) ?? null;
	const label = KIND_LABEL[kind];

	if (!job || job.status === "running") {
		return <DispatchActivityCard job={job} label={label} />;
	}
	const failed = job.status === "error";
	return (
		<div
			className="flex items-center gap-2.5 text-[15px] text-ink-2"
			data-testid="dispatch-settled"
		>
			<PixelIcon name={failed ? "close" : "check"} className={cn(failed && "text-ans-wrong")} />
			<span className="text-ink">{label}</span>
			<span className="text-sm">{failed ? "failed" : "finished"}</span>
		</div>
	);
}

function DispatchActivityCard({ job, label }: { job: JobRecord | null; label: string }) {
	// Elapsed from createdAt, ticking while the job runs. Jobs appear here
	// only via the jobs feed (post-mount), so no SSR/hydration mismatch.
	const now = useNow(job?.status === "running");
	const elapsed =
		job && job.createdAt ? Math.max(0, Math.round((now - Date.parse(job.createdAt)) / 1000)) : null;
	return (
		<div
			className={cn(CARD, "flex flex-col gap-2 py-3 text-card-foreground")}
			data-testid="dispatch-card"
		>
			<div className="flex items-center gap-2.5 text-base text-ink">
				{/* The Braille spinner: one working indicator everywhere. */}
				<BrailleSpinner label={`${label} running`} />
				{label}
				{elapsed !== null && <span className="font-count text-[15px] text-ink-2">{elapsed}s</span>}
			</div>
			{job?.activity && (
				<div className="truncate font-count text-[15px] text-ink-2" data-testid="dispatch-activity-line">
					{job.activity}
				</div>
			)}
			{!job && (
				<div className="text-sm text-ink-2" data-testid="dispatch-pending">
					Dispatched…
				</div>
			)}
		</div>
	);
}
