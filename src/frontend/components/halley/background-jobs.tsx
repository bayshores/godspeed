import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { subscriptionLabel, subscriptionLabels } from "@/shared/core";
import { useActivity, type ActivityFeed } from "@/frontend/components/activity-dock";
import { useFold } from "@/frontend/components/use-fold";
import { useNow } from "@/frontend/components/use-now";
import { formatTokens, planCostLabel } from "@/frontend/components/usage-format";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { blobLabel, formatElapsed, toBlobs, type ActivityBlob } from "./activity-model";

/**
 * "Running in the background": jobs that failed lately, then one row per
 * running sub-agent job or fact-building run, with a Stop button (POST
 * /api/activity/abort). 404/409 mean it already ended (refresh, no error);
 * a real failure says so and Stop stays clickable. Clicking a row opens its
 * detail inline (the list scrolls, so a popover would clip). Hidden when
 * there is nothing to show.
 */

/** A Stop that was sent, or failed. */
type AbortState = "pending" | "failed";

/** One run of a row: a later run of the same source reuses the row id, so
 *  the state keys on its start too and never carries over. */
const runKey = (blob: ActivityBlob) => `${blob.id}@${blob.startedAt}`;

const ROW = "border-b border-dotted border-edge last:border-b-0";

export function BackgroundJobs({ feed, waiting }: { feed: ActivityFeed; waiting: string | null }) {
	const { refresh } = useActivity();
	const blobs = useMemo(() => toBlobs(feed), [feed]);
	const [openBlob, setOpenBlob] = useState<string | null>(null);
	const [abortStates, setAbortStates] = useState<Record<string, AbortState>>({});
	const now = useNow(blobs.length > 0); // elapsed counts up while jobs run
	// Stable abort handler (no new closure every tick).
	const refreshRef = useRef(refresh);
	refreshRef.current = refresh;
	// Forget the states of runs that left the feed.
	useEffect(() => {
		const live = new Set(blobs.map(runKey));
		setAbortStates((s) => {
			const kept = Object.entries(s).filter(([k]) => live.has(k));
			return kept.length === Object.keys(s).length ? s : Object.fromEntries(kept);
		});
	}, [blobs]);

	const abort = useCallback(async (blob: ActivityBlob) => {
		const key = runKey(blob);
		setAbortStates((s) => ({ ...s, [key]: "pending" }));
		try {
			const res = await fetch("/api/activity/abort", {
				method: "POST",
				headers: { "content-type": "application/json" },
				// A fact-building run stops by its source id: chunk rows share
				// one source and stop together.
				body: JSON.stringify({ kind: blob.process, id: blob.process === "extraction" ? blob.chatId : blob.id }),
			});
			if (!res.ok) {
				// Not found / not running: it already ended, which is what Stop wants.
				if (res.status === 404 || res.status === 409) {
					refreshRef.current();
					setAbortStates((s) => {
						const { [key]: _drop, ...rest } = s;
						return rest;
					});
					return;
				}
				throw new Error(String(res.status));
			}
			refreshRef.current();
		} catch {
			setAbortStates((s) => ({ ...s, [key]: "failed" }));
		}
	}, []);

	const failed = feed.failed ?? [];
	if (!waiting && failed.length === 0 && blobs.length === 0) return null;
	return (
		<section data-testid="activity-section" className="flex flex-col gap-3.5">
			<div className="flex items-baseline gap-2">
				<h3 className="min-w-0 flex-1 text-[17px] font-normal text-ink">Running in the background</h3>
				{blobs.length > 0 && (
					<span data-testid="activity-total-cost" title="Total running cost" className="shrink-0 font-count text-[15px] text-ink-2">
						{planCostLabel(subscriptionLabels(blobs.map((blob) => blob.model)))}
					</span>
				)}
			</div>
			{waiting && (
				<p data-testid="activity-waiting" className="text-[15px] text-ink-2">
					{waiting}
				</p>
			)}
			{(failed.length > 0 || blobs.length > 0) && (
				<div className="flex flex-col border-y-[1.5px] border-ink">
					{failed.map((f) => (
						<div key={f.id} data-testid="activity-failed" className={`flex flex-col gap-0.5 py-2.5 ${ROW}`}>
							<span className="truncate text-lg text-ink" title={f.title}>
								{f.title}
							</span>
							<span className="break-words text-base text-ans-wrong">Failed: {f.error}</span>
						</div>
					))}
					{blobs.map((blob) => (
						<JobRow
							key={blob.id}
							blob={blob}
							now={now}
							detailOpen={openBlob === blob.id}
							onToggleDetail={() => setOpenBlob((id) => (id === blob.id ? null : blob.id))}
							abortState={abortStates[runKey(blob)]}
							onAbort={() => void abort(blob)}
						/>
					))}
				</div>
			)}
		</section>
	);
}

/** One running job: its name, what it is and how long it has run, Stop.
 *  Click the name to open the detail under it. */
function JobRow({
	blob,
	now,
	detailOpen,
	onToggleDetail,
	abortState,
	onAbort,
}: {
	blob: ActivityBlob;
	now: number;
	detailOpen: boolean;
	onToggleDetail: () => void;
	abortState: AbortState | undefined;
	onAbort: () => void;
}) {
	const detail = useFold(detailOpen);
	const label = blobLabel(blob);
	const elapsed = formatElapsed(now - blob.startedAt);
	const doing = blob.activity || blob.phase;
	return (
		// A new job rises in once (keyed by id, so the clock's re-render never replays it).
		<div data-testid={`activity-blob-${blob.process}`} className={`lh-rise flex flex-col ${ROW}`}>
			<div className="flex items-center gap-3 py-2.5">
				<button type="button" onClick={onToggleDetail} aria-expanded={detailOpen} className="lh-press flex min-w-0 flex-1 flex-col gap-0.5 text-left">
					<span className="w-full truncate text-lg text-ink" title={blob.title}>
						{blob.title}
					</span>
					<span className="w-full truncate text-base text-ink-2">
						{label}, <span data-testid="activity-blob-elapsed">{elapsed}</span>
					</span>
				</button>
				<button
					type="button"
					data-testid="activity-abort"
					onClick={onAbort}
					disabled={abortState === "pending"}
					title={abortState === "failed" ? "Abort failed. Try again." : undefined}
					aria-label={`Stop ${label} in ${blob.title}`}
					className="lh-btn h-auto shrink-0 px-2.5 py-1 text-[15px]"
				>
					Stop
				</button>
			</div>
			{detail.mounted && (
				<div className="lh-collapse" data-state={detail.state}>
					<div>
						<div data-testid="activity-blob-detail" className="mb-2.5 flex flex-col gap-1 bg-tone px-3 py-2.5 text-base text-ink-2">
							{doing && (
								<p className="break-words text-ink" title={doing}>
									{doing}
								</p>
							)}
							<DetailRow name="Cost">
								<span data-testid="activity-blob-cost" className="font-count">
									{planCostLabel(subscriptionLabel(blob.model))}
								</span>
							</DetailRow>
							<DetailRow name="Context">
								<span data-testid="activity-blob-context" className="font-count">
									{blob.context === null ? "–" : `${formatTokens(blob.context.used)} / ${formatTokens(blob.context.limit)}`}
								</span>
							</DetailRow>
							{blob.model && (
								<DetailRow name="Model">
									<span className="truncate">{blob.model}</span>
								</DetailRow>
							)}
							{blob.steps !== undefined && (
								<DetailRow name="Steps">
									<span className="font-count">{blob.steps}</span>
								</DetailRow>
							)}
							{blob.opensLesson && (
								<a href={`/chat/${blob.chatId}`} className="lh-press flex items-center gap-2 self-start text-ink hover:underline">
									Open lesson
									<PixelIcon name="chevron" />
								</a>
							)}
							{abortState === "failed" && <p className="text-ans-wrong">Abort failed. Try again.</p>}
							{abortState === "pending" && <p>Stopping…</p>}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

function DetailRow({ name, children }: { name: string; children: React.ReactNode }) {
	return (
		<div className="flex justify-between gap-2">
			<span>{name}</span>
			<span className="flex min-w-0 text-ink">{children}</span>
		</div>
	);
}
