/**
 * The teacher's Activity list, its words and its rows. Pure.
 *
 * Background jobs: the feed's sub-agent jobs and fact-building runs, merged
 * into one oldest-first list (stable order, so refreshes land in place).
 * The context line is the LAST model call's footprint against the model's
 * limit, never a running sum. Absent data shows "–", never zero.
 */
import type { JobKind } from "@/shared/core";
import type { ActivityFeed } from "@/frontend/components/activity-dock";

/** One running background job: a sub-agent job or a fact-building run. */
export interface ActivityBlob {
	/** job.id, or the run's row id (source id, or "src#i" for chunk jobs). */
	id: string;
	process: "job" | "extraction";
	/** Sub-agent kind (fact-building runs have none). */
	jobKind?: JobKind;
	/** Fact-building phase (waiting/extracting/merging/grouping). */
	phase?: string;
	title: string;
	chatId: string;
	/** chatId names a lesson the detail can link to. */
	opensLesson: boolean;
	/** ms epoch: the order, and where elapsed counts from. */
	startedAt: number;
	/** Last model call's footprint vs the model's limit; null shows "–". */
	context: { used: number; limit: number } | null;
	/** Latest activity line (""). */
	activity: string;
	model?: string;
	/** Model calls made so far, when usage is reported. */
	steps?: number;
}

/** Merge the feed into one oldest-first list. */
export function toBlobs(feed: ActivityFeed): ActivityBlob[] {
	const blobs: ActivityBlob[] = feed.jobs.map((job) => {
		const usage = job.usage;
		const lastStep = usage?.lastStep;
		// The limit comes from the feed (the server's live model catalog).
		const limit = job.contextLimit;
		let context: ActivityBlob["context"] = null;
		if (usage && lastStep && limit !== null && lastStep.inputTokens !== undefined) {
			// Same sum as the session meter: provider "input" leaves out the
			// cache, so input+output alone reads far too low.
			context = {
				used:
					lastStep.inputTokens +
					(lastStep.outputTokens ?? 0) +
					(lastStep.cacheReadTokens ?? 0) +
					(lastStep.cacheWriteTokens ?? 0),
				limit,
			};
		}
		return {
			id: job.id,
			process: "job",
			jobKind: job.kind,
			title: job.title,
			chatId: job.chatId,
			opensLesson: true,
			startedAt: Date.parse(job.createdAt) || 0,
			context,
			activity: job.activity ?? "",
			model: usage?.model,
			steps: usage?.steps,
		};
	});
	for (const run of feed.extractions) {
		blobs.push({
			id: run.id,
			process: "extraction",
			phase: run.phase,
			title: run.title,
			chatId: run.chatId,
			opensLesson: run.kind === "chat",
			startedAt: run.startedAt,
			context: null,
			activity: "",
		});
	}
	blobs.sort((a, b) => a.startedAt - b.startedAt);
	return blobs;
}

/** Elapsed as a compact ticking string: 45s / 3m 04s / 1h 12m. */
export function formatElapsed(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
	return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

const JOB_LABEL: Record<JobKind, string> = {
	research: "Research agent",
	demo: "Demo builder",
	visual: "Figure maker",
	pdf: "PDF reader",
};

/** What a background job is: "Building facts", "Research agent". */
export function blobLabel(blob: Pick<ActivityBlob, "process" | "jobKind">): string {
	if (blob.process === "extraction") return "Building facts";
	return (blob.jobKind && JOB_LABEL[blob.jobKind]) || "Sub-agent";
}

/** How long ago a Recent change was: "now", "2 min", "1 hour", "yesterday",
 *  "3 days", then its date ("Nov 5"). */
export function agoLabel(iso: string, now: number): string {
	const at = new Date(iso);
	const ms = now - at.getTime();
	if (Number.isNaN(ms)) return "";
	const min = Math.floor(ms / 60_000);
	if (min < 1) return "now";
	if (min < 60) return `${min} min`;
	const h = Math.floor(min / 60);
	if (h < 24) return `${h} hour${h === 1 ? "" : "s"}`;
	const d = Math.floor(h / 24);
	if (d === 1) return "yesterday";
	if (d < 7) return `${d} days`;
	return at.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(at.getFullYear() !== new Date(now).getFullYear() && { year: "numeric" }) });
}
