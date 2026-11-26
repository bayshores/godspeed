/**
 * The godspeed folder as the server sees it (GET /api/agent-folder), with the agent that runs the
 * lessons, read once for the window. Every change goes through `post` or `pick`, whose answer is
 * the view every reader then shows.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { FolderAgent, OldSetup } from "@/shared/core";
import { useServerResource } from "@/frontend/components/use-server-resource";
import type { FolderView } from "./agent-folder-model";
import { pickAgent, pickModel as patchModel, postAgentFolder, sendOldAgent } from "./agent-folder-api";

interface FolderState {
	/** null until read. */
	view: FolderView | null;
	/** One action; its answer becomes the view. Throws the line to show. */
	post: (body: object) => Promise<FolderView>;
	/** The agent that runs the lessons, picked. Throws the line to show. */
	pick: (agent: FolderAgent) => Promise<FolderView>;
	/** The model an agent's new lessons start on, picked (null: its default). Throws the line to show. */
	pickModel: (agent: FolderAgent, model: string | null) => Promise<FolderView>;
	/** What Remove took away, for the restart note; null until then. */
	removed: OldSetup | null;
	setRemoved: (setup: OldSetup) => void;
}

const FolderContext = createContext<FolderState | null>(null);

export function AgentFolderProvider({ children }: { children: ReactNode }) {
	const { value: view, update } = useServerResource<FolderView>("/api/agent-folder");
	const [removed, setRemoved] = useState<OldSetup | null>(null);
	const post = useCallback(
		async (body: object) => {
			const next = await postAgentFolder(body);
			update(() => next);
			return next;
		},
		[update],
	);
	const pick = useCallback(
		async (agent: FolderAgent) => {
			const next = await pickAgent(agent);
			update(() => next);
			return next;
		},
		[update],
	);
	const pickModel = useCallback(
		async (agent: FolderAgent, model: string | null) => {
			const next = await patchModel(agent, model);
			update(() => next);
			return next;
		},
		[update],
	);
	useEffect(() => {
		sendOldAgent(pick).catch((err: unknown) => console.error("[agent folder] the agent this window kept could not be sent:", err));
	}, [pick]);
	const value = useMemo(() => ({ view, post, pick, pickModel, removed, setRemoved }), [view, post, pick, pickModel, removed]);
	return <FolderContext.Provider value={value}>{children}</FolderContext.Provider>;
}

/** Outside a provider (isolated renders, tests): nothing read, and posts
 *  that still reach the server. */
const OUTSIDE: FolderState = { view: null, post: postAgentFolder, pick: pickAgent, pickModel: patchModel, removed: null, setRemoved: () => {} };

export function useAgentFolderView(): FolderState {
	return useContext(FolderContext) ?? OUTSIDE;
}
