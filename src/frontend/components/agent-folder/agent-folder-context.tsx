/**
 * The godspeed folder as the server sees it (GET /api/agent-folder), read
 * once for the window. Every change goes through `post`, whose answer is
 * the view every reader then shows.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { OldSetup } from "@/shared/core";
import { useServerResource } from "@/frontend/components/use-server-resource";
import type { FolderView } from "./agent-folder-model";
import { postAgentFolder } from "./agent-folder-api";

interface FolderState {
	/** null until read. */
	view: FolderView | null;
	/** Read it again: a terminal start may have made the folder. */
	reload: () => Promise<void>;
	/** One action; its answer becomes the view. Throws the line to show. */
	post: (body: object) => Promise<FolderView>;
	/** What Remove took away, for the restart note; null until then. */
	removed: OldSetup | null;
	setRemoved: (setup: OldSetup) => void;
}

const FolderContext = createContext<FolderState | null>(null);

export function AgentFolderProvider({ children }: { children: ReactNode }) {
	const { value: view, reload, update } = useServerResource<FolderView>("/api/agent-folder");
	const [removed, setRemoved] = useState<OldSetup | null>(null);
	const post = useCallback(
		async (body: object) => {
			const next = await postAgentFolder(body);
			update(() => next);
			return next;
		},
		[update],
	);
	const value = useMemo(() => ({ view, reload, post, removed, setRemoved }), [view, reload, post, removed]);
	return <FolderContext.Provider value={value}>{children}</FolderContext.Provider>;
}

/** Outside a provider (isolated renders, tests): nothing read, and posts
 *  that still reach the server. */
const OUTSIDE: FolderState = { view: null, reload: async () => {}, post: postAgentFolder, removed: null, setRemoved: () => {} };

export function useAgentFolderView(): FolderState {
	return useContext(FolderContext) ?? OUTSIDE;
}
