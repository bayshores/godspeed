import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { SpaceSheetsView } from "@/shared/core";
import { useSpaces } from "@/frontend/components/space-context";
import { useServerResource } from "@/frontend/components/use-server-resource";

interface SpaceSheets {
	/** null until read. */
	view: SpaceSheetsView | null;
	failed: boolean;
	reload: () => Promise<void>;
}

const RELOAD_ON = { "cheat-sheet-changed": true, "spaces-changed": true } as const;

function useRead(spaceId: string | null): SpaceSheets {
	const { value: view, error, reload } = useServerResource<SpaceSheetsView>(spaceId ? `/api/spaces/${encodeURIComponent(spaceId)}/cheat-sheets` : null, { on: RELOAD_ON });
	return useMemo(() => ({ view, failed: error !== null, reload }), [view, error, reload]);
}

const ActiveSheetsContext = createContext<{ spaceId: string | null; read: SpaceSheets } | null>(null);

/** The active space's sheets, read once for the window, so the Deadlines tab opens with each
 *  row's cheat sheet key drawn. */
export function ActiveSpaceSheetsProvider({ children }: { children: ReactNode }) {
	const { active } = useSpaces();
	const read = useRead(active);
	const value = useMemo(() => ({ spaceId: active, read }), [active, read]);
	return <ActiveSheetsContext.Provider value={value}>{children}</ActiveSheetsContext.Provider>;
}

/** A space's deadlines with where each sheet is, read again whenever a sheet or the space
 *  changes: the window's shared read for the active space, its own read for another one. */
export function useSpaceSheets(spaceId: string | null): SpaceSheets {
	const shared = useContext(ActiveSheetsContext);
	const isShared = shared !== null && spaceId === shared.spaceId;
	const own = useRead(isShared ? null : spaceId);
	return isShared ? shared.read : own;
}
