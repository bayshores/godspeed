import { useCallback, useEffect, useRef, useState } from "react";
import { useActivity } from "@/components/activity-dock";
import { formatTokens } from "@/components/usage-format";

/**
 * The coverage block in the sidebar's lesson context menu: how much of one
 * session the graph extractor hasn't covered yet, plus a manual Extract.
 * Coverage comes from GET /api/chats/[id] (`coverage`).
 *
 * Extract posts to /api/graph/coverage/extract {chatId}. A 409 means a run
 * is already in flight, which is fine: the activity dock refreshes either way.
 */

/** Client-safe mirror of the server's SessionCoverage (src/server/chats.ts
 *  — the GET /api/chats/[id] `coverage` block). */
export interface SessionCoverage {
	totalMessages: number;
	coveredCount: number;
	uncoveredCount: number;
	coveredTokens: number;
	uncoveredTokens: number;
	running: boolean;
	lastFoldedAt: string | null;
}

/** One session's coverage read — null on transport/404 (callers render
 *  nothing rather than a fake zero; the honest-render doctrine). */
async function fetchCoverage(chatId: string): Promise<SessionCoverage | null> {
	try {
		const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}`);
		if (!res.ok) return null;
		const body = (await res.json()) as { coverage?: SessionCoverage | null };
		return body.coverage ?? null;
	} catch {
		return null;
	}
}

/** The manual-extract request. 409 (a run is already in flight) counts as
 *  started, so the caller shows the running state instead of an error.
 *  Returns false only on a real failure, where the caller reverts. */
async function requestExtract(chatId: string): Promise<boolean> {
	try {
		const res = await fetch("/api/graph/coverage/extract", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ chatId }),
		});
		if (!res.ok && res.status !== 409) return false;
		return true; // 202 started, or 409 already-running — both "running"
	} catch {
		return false;
	}
}

/**
 * The info block at the bottom of the session context menu: what the
 * extractor hasn't covered yet, plus the manual Extract affordance, visually separated from Rename/Delete below (those stay the
 * two session-management actions). Fetched ON MENU OPEN (the block mounts
 * with the menu — on-demand, never eagerly), polled at 2s while a run is
 * in flight so the numbers settle live. No coverage (fetch failed, 404):
 * the whole block renders nothing — no fake zeros.
 */
export function CoverageMenuBlock({ chatId }: { chatId: string }) {
	const refreshActivity = useActivity().refresh;
	const [coverage, setCoverage] = useState<SessionCoverage | null>(null);
	const [extracting, setExtracting] = useState(false); // optimistic until the server says running
	const lastUncoveredRef = useRef<number | null>(null);

	const load = useCallback(async () => {
		const next = await fetchCoverage(chatId);
		if (next === null) return;
		// The optimistic state stands down once the server says running, or
		// once the fold moved coverage (the run finished).
		if (
			next.running ||
			(lastUncoveredRef.current !== null && next.uncoveredTokens !== lastUncoveredRef.current)
		) {
			setExtracting(false);
		}
		lastUncoveredRef.current = next.uncoveredTokens;
		setCoverage(next);
	}, [chatId]);

	// On MENU OPEN (the block mounts with the menu — on-demand, never
	// eagerly): one read, then the 2s poll below takes over while running.
	useEffect(() => {
		lastUncoveredRef.current = null;
		setExtracting(false);
		void load();
	}, [load]);

	// While a run is in flight the block polls at 2s so the numbers settle
	// live. Coverage moves per fold but the events channel only reports per
	// phase, so this bounded, run-scoped poll stays.
	useEffect(() => {
		if (coverage?.running !== true && !extracting) return;
		const timer = setInterval(() => void load(), 2000);
		return () => clearInterval(timer);
	}, [load, coverage?.running, extracting]);

	if (coverage === null) return null;

	const onExtract = async () => {
		setExtracting(true);
		// The dock's start-site nudge (the 202 registers the run before the
		// response; a 409 means one is already in flight) — refresh so the
		// run surfaces at once either way.
		refreshActivity();
		const started = await requestExtract(chatId);
		if (!started) setExtracting(false);
		void load();
	};
	return (
		<CoverageMenuBody
			coverage={coverage}
			extracting={extracting}
			onExtract={() => void onExtract()}
		/>
	);
}

/** The block's presentational core (exported for static-render tests):
 *  the numbers, the running pulse, and the Extract affordance with its
 *  optimistic "Running" state. */
export function CoverageMenuBody({
	coverage,
	extracting,
	onExtract,
}: {
	coverage: SessionCoverage;
	/** Click-pending (optimistic) until the server says running. */
	extracting: boolean;
	onExtract: () => void;
}) {
	const busy = coverage.running || extracting;
	const complete = coverage.uncoveredTokens === 0 && coverage.uncoveredCount === 0;
	return (
		<div data-testid="ctx-coverage" className="flex flex-col gap-1 px-2.5 pt-1 pb-2">
			{busy ? (
				<span className="flex items-center gap-1.5 text-muted-foreground" data-testid="ctx-coverage-running">
					<span className="size-1.5 animate-pulse rounded-full bg-foreground/70" aria-hidden />
					extracting…
				</span>
			) : complete ? (
				<span className="text-muted-foreground">fully extracted</span>
			) : (
				<span className="flex flex-col">
					<span className="font-mono tabular-nums text-foreground">
						{formatTokens(coverage.uncoveredTokens)} tok uncovered
					</span>
					<span className="font-mono tabular-nums text-muted-foreground">
						{coverage.uncoveredCount} message{coverage.uncoveredCount === 1 ? "" : "s"} unextracted
					</span>
				</span>
			)}
			<button
				type="button"
				data-testid="ctx-extract"
				onClick={onExtract}
				disabled={busy || complete}
				className="lh-press flex items-center justify-center border px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
			>
				{busy ? "Running" : "Extract"}
			</button>
		</div>
	);
}
