/**
 * useProgress: the active
 * space's ProgressPayload from GET /api/progress, read once for the window
 * (ProgressProvider in the app shell), so a page that shows it opens with it
 * drawn.
 *
 * Re-reads when the space changes, when a turn settles (new answers), when
 * background activity changes (a graph build or the topic grouper
 * finished), when spaces change (deadlines edited), when a lesson is made,
 * renamed, deleted or moved, and after the events channel reconnects.
 * Events are debounced, so a burst of updates causes one read.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { localDay, type ProgressPayload, type ServerEventType } from "@/shared/core";
import { getJson } from "@/frontend/lib/api";
import { useTrailing } from "@/frontend/lib/use-trailing";
import { spaceQuery, useSpaces } from "@/frontend/components/space-context";
import { useServerEvents, useServerResync } from "@/frontend/components/server-events";
import { useServerResource } from "@/frontend/components/use-server-resource";
import type { ReloadOn } from "@/frontend/components/server-resource-model";

const REFRESH_DEBOUNCE_MS = 400;
const PROGRESS_EVENTS = ["turn-settled", "activity-changed", "spaces-changed", "chats-changed"] as const satisfies readonly ServerEventType[];
const RELOAD_ON: ReloadOn = Object.fromEntries(PROGRESS_EVENTS.map((type) => [type, true]));

const progressUrl = (spaceId: string | null) => `/api/progress${spaceQuery(spaceId)}&today=${localDay()}`;

/** One space's progress (null: the lessons with no space); throws the server's message. */
export async function fetchProgress(spaceId: string | null): Promise<ProgressPayload> {
	const { error, body } = await getJson<ProgressPayload>(progressUrl(spaceId));
	if (error !== null || body === null) throw new Error(error ?? "No progress");
	return body;
}

/** `load` again on the same events as useProgress, debounced the same,
 *  and at once after the events channel reconnects. */
export function useProgressRefresh(load: () => void): void {
	const later = useTrailing(load, REFRESH_DEBOUNCE_MS);
	useServerEvents(PROGRESS_EVENTS, later);
	useServerResync(load);
}

interface Progress {
	/** null until the first response (or after an error with no data yet). */
	data: ProgressPayload | null;
	error: string | null;
	/** Read it again now (Try again). */
	refresh: () => Promise<void>;
}

const ProgressContext = createContext<Progress | null>(null);

export function ProgressProvider({ children }: { children: ReactNode }) {
	const { active } = useSpaces();
	const { value, error, reload } = useServerResource<ProgressPayload>(progressUrl(active), { on: RELOAD_ON, debounceMs: REFRESH_DEBOUNCE_MS });
	const progress = useMemo(() => ({ data: value, error, refresh: reload }), [value, error, reload]);
	return <ProgressContext.Provider value={progress}>{children}</ProgressContext.Provider>;
}

export function useProgress(): Progress {
	const shared = useContext(ProgressContext);
	if (!shared) throw new Error("useProgress outside ProgressProvider");
	return shared;
}
