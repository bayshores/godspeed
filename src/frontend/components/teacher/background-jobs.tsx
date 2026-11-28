import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { DEFAULT_TEACHER_NAME, subscriptionLabel, subscriptionLabels } from "@/shared/core";
import { useActivity, type ActivityFeed } from "@/frontend/components/activity-dock";
import { useFold } from "@/frontend/components/use-fold";
import { useGuardedAction } from "@/frontend/components/use-guarded-action";
import { useNow } from "@/frontend/components/use-now";
import { formatTokens, planCostLabel } from "@/frontend/components/usage-format";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { jsonInit, send } from "@/frontend/lib/api";
import { ACTIVITY_ROW, ACTIVITY_ROWS } from "./activity-look";
import { blobLabel, formatElapsed, toBlobs, type ActivityBlob } from "./activity-model";
import { useTeacher } from "./teacher-context";

/**
 * "Running in the background": jobs that failed lately, then one row per
 * running sub-agent job, fact-building run or deadline request, a Stop button on the first two (POST
 * /api/activity/abort), then one row per panel chat writing a reply that no thread on screen shows
 * (`chats`), with its Stop. 404/409 mean it already ended (refresh, no error);
 * a real failure says so and Stop stays clickable. Clicking a row opens its
 * detail inline (the list scrolls, so a popover would clip). Hidden when
 * there is nothing to show.
 */

/** A Stop that was sent, or failed. */
type AbortState = "pending" | "failed";

/** One run of a row: a later run of the same source reuses the row id, so
 *  the state keys on its start too and never carries over. */
const runKey = (blob: ActivityBlob) => `${blob.id}@${blob.startedAt}`;

export function BackgroundJobs({ feed, chats }: { feed: ActivityFeed; chats: readonly RunningChat[] }) {
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
		// A fact-building run stops by its source id: chunk rows share one source and stop together.
		const { error, status } = await send("/api/activity/abort", jsonInit("POST", { kind: blob.process, id: blob.process === "extraction" ? blob.chatId : blob.id }));
		if (!error) return refreshRef.current();
		// Not found / not running: it already ended, which is what Stop wants.
		if (status === 404 || status === 409) {
			refreshRef.current();
			setAbortStates((s) => {
				const { [key]: _drop, ...rest } = s;
				return rest;
			});
		} else setAbortStates((s) => ({ ...s, [key]: "failed" }));
	}, []);

	const failed = feed.failed ?? [];
	if (failed.length === 0 && blobs.length === 0 && chats.length === 0) return null;
	return (
		<section data-testid="activity-section" className="flex flex-col gap-3">
			<div className="flex items-baseline gap-2">
				<h3 className="min-w-0 flex-1 text-item font-normal text-ink">Running in the background</h3>
				{blobs.length > 0 && (
					<span data-testid="activity-total-cost" title="Total running cost" className="shrink-0 font-count text-ui text-ink-2">
						{planCostLabel(subscriptionLabels(blobs.map((blob) => blob.model)))}
					</span>
				)}
			</div>
			<div className={ACTIVITY_ROWS}>
				{failed.map((f) => (
					<div key={f.id} data-testid="activity-failed" className={`flex flex-col gap-0.5 py-2.5 ${ACTIVITY_ROW}`}>
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
				{chats.map((chat) => (
					<ChatRow key={chat.id} chat={chat} />
				))}
			</div>
		</section>
	);
}

/** A panel chat writing a reply. */
export interface RunningChat {
	id: string;
	title: string;
}

/** One panel chat writing a reply: its name and Stop. The row goes when the reply ends. */
function ChatRow({ chat }: { chat: RunningChat }) {
	const { busy, error, run } = useGuardedAction();
	const stop = () =>
		void run(async () => {
			const { error, status } = await send("/api/activity/abort", jsonInit("POST", { kind: "turn", id: chat.id }));
			// Not found / not running: it already ended, which is what Stop wants.
			return status === 404 || status === 409 ? null : error;
		});
	return (
		<div data-testid="activity-chat" className={`lh-rise flex flex-col ${ACTIVITY_ROW}`}>
			<div className="flex items-center gap-3 py-2.5">
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="w-full truncate text-lg text-ink" title={chat.title}>
						{chat.title}
					</span>
					<span className="w-full truncate text-base text-ink-2">Chat</span>
				</span>
				<button type="button" data-testid="activity-chat-stop" onClick={stop} disabled={busy} aria-label={`Stop the reply in ${chat.title}`} className="lh-btn lh-btn-small shrink-0">
					Stop
				</button>
			</div>
			{error && <p className="pb-2.5 text-base text-ans-wrong">Stop didn't go through. Try again.</p>}
		</div>
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
	const label = blobLabel(blob, useTeacher()?.name ?? DEFAULT_TEACHER_NAME);
	const elapsed = formatElapsed(now - blob.startedAt);
	const doing = blob.activity || blob.phase;
	return (
		// A new job rises in once (keyed by id, so the clock's re-render never replays it).
		<div data-testid={`activity-blob-${blob.process}`} className={`lh-rise flex flex-col ${ACTIVITY_ROW}`}>
			<div className="flex items-center gap-3 py-2.5">
				<button type="button" onClick={onToggleDetail} aria-expanded={detailOpen} className="lh-press flex min-w-0 flex-1 flex-col gap-0.5 text-left">
					<span className="w-full truncate text-lg text-ink" title={blob.title}>
						{blob.title}
					</span>
					<span className="w-full truncate text-base text-ink-2">
						{label}, <span data-testid="activity-blob-elapsed">{elapsed}</span>
					</span>
				</button>
				{blob.process !== "request" && (
					<button
						type="button"
						data-testid="activity-abort"
						onClick={onAbort}
						disabled={abortState === "pending"}
						title={abortState === "failed" ? "Abort failed. Try again." : undefined}
						aria-label={`Stop ${label} in ${blob.title}`}
						className="lh-btn lh-btn-small shrink-0"
					>
						Stop
					</button>
				)}
			</div>
			{detail.mounted && (
				<div className="lh-collapse" data-state={detail.state}>
					<div>
						<div data-testid="activity-blob-detail" className="flex flex-col gap-1 pb-3 text-base text-ink-2">
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
								<Link to={`/chat/${blob.chatId}`} className="lh-press flex items-center gap-2 self-start text-ink hover:underline">
									Open lesson
									<PixelIcon name="chevron" />
								</Link>
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
