/**
 * The full record of a space (GET /api/spaces/:id: files and deadlines
 * included) and its linked folder as the last scan saw it. The active
 * space's record is read once for the window (ActiveSpaceRecordProvider);
 * another space's is read by the page that asks for it.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { FolderStatus, SpaceRecord } from "@/shared/core";
import { useSpaces } from "@/frontend/components/space-context";
import { useServerResource } from "@/frontend/components/use-server-resource";

/** GET /api/spaces/:id. */
export interface SpaceRead {
	space: SpaceRecord;
	folder: FolderStatus;
	/** The space's folder of shortcuts in the godspeed folder. */
	shortcuts?: string | null;
}

interface SpaceRecordState {
	/** null until loaded, and for "No space". */
	record: SpaceRecord | null;
	folder: FolderStatus | null;
	shortcuts: string | null;
	/** The last read failed. */
	failed: boolean;
	reload: () => Promise<void>;
}

export const spaceUrl = (spaceId: string) => `/api/spaces/${encodeURIComponent(spaceId)}`;

const RELOAD_ON = { "spaces-changed": true } as const;

function useRead(spaceId: string | null): SpaceRecordState {
	const { value, error, reload } = useServerResource<SpaceRead>(spaceId ? spaceUrl(spaceId) : null, { on: RELOAD_ON });
	return useMemo(
		() => ({ record: value?.space ?? null, folder: value?.folder ?? null, shortcuts: value?.shortcuts ?? null, failed: error !== null, reload }),
		[value, error, reload],
	);
}

const ActiveRecordContext = createContext<{ spaceId: string | null; read: SpaceRecordState } | null>(null);

export function ActiveSpaceRecordProvider({ children }: { children: ReactNode }) {
	const { active } = useSpaces();
	const read = useRead(active);
	const value = useMemo(() => ({ spaceId: active, read }), [active, read]);
	return <ActiveRecordContext.Provider value={value}>{children}</ActiveRecordContext.Provider>;
}

/** A space's record: the window's shared read for the active space, its
 *  own read for another one. */
export function useSpaceRecord(spaceId: string | null): SpaceRecordState {
	const shared = useContext(ActiveRecordContext);
	const isShared = shared !== null && spaceId === shared.spaceId;
	const own = useRead(isShared ? null : spaceId);
	return isShared ? shared.read : own;
}
