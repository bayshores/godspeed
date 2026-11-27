/**
 * The godspeed folder as the server sees it (GET /api/agent-folder), with the agent that runs the
 * lessons, read once for the window. Every change goes through `post` or `pick`, whose answer is
 * the view every reader then shows.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { FolderAgent, OldSetup } from "@/shared/core";
import { useServerResource } from "@/frontend/components/use-server-resource";
import type { WriteResult } from "@/frontend/lib/api";
import type { FolderView } from "./agent-folder-model";
import { folderWriters, sendOldAgent } from "./agent-folder-api";

interface FolderState {
	/** null until read. */
	view: FolderView | null;
	/** One action; its answer becomes the view. Resolves to the line to show, or null. */
	post: (body: object) => Promise<WriteResult>;
	/** The agent that runs the lessons, picked. */
	pick: (agent: FolderAgent) => Promise<WriteResult>;
	/** The model an agent's new lessons start on, picked (null: its default). */
	pickModel: (agent: FolderAgent, model: string | null) => Promise<WriteResult>;
	/** What Remove took away, for the restart note; null until then. */
	removed: OldSetup | null;
	setRemoved: (setup: OldSetup) => void;
}

const FolderContext = createContext<FolderState | null>(null);

export function AgentFolderProvider({ children }: { children: ReactNode }) {
	const { value: view, update } = useServerResource<FolderView>("/api/agent-folder");
	const [removed, setRemoved] = useState<OldSetup | null>(null);
	const writers = useMemo(() => folderWriters((next) => update(() => next)), [update]);
	const { pick } = writers;
	useEffect(() => {
		void sendOldAgent(pick).then((line) => line && console.error("[agent folder] the agent this window kept could not be sent:", line));
	}, [pick]);
	const value = useMemo(() => ({ view, ...writers, removed, setRemoved }), [view, writers, removed]);
	return <FolderContext.Provider value={value}>{children}</FolderContext.Provider>;
}

/** Outside a provider (isolated renders, tests): nothing read, and posts
 *  that still reach the server. */
const OUTSIDE: FolderState = { view: null, ...folderWriters(() => {}), removed: null, setRemoved: () => {} };

export function useAgentFolderView(): FolderState {
	return useContext(FolderContext) ?? OUTSIDE;
}
