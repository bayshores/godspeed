import { useCallback } from "react";
import type { FolderAgent } from "@/shared/core";
import type { WriteResult } from "@/frontend/lib/api";
import { useAgentFolderView } from "./agent-folder-context";

/** The godspeed folder in Settings, Teacher: change() picks another folder, setStartCommand() saves
 *  the learner's own command for starting the agent. */
export function useAgentFolder() {
	const { view, post } = useAgentFolderView();

	/** Use another folder (the native picker); null when cancelled. Resolves to an error message, if any. */
	const change = useCallback(async (): Promise<WriteResult> => {
		const folder = await window.lh?.pickFolder?.();
		return folder ? post({ action: "setup", folder }) : null;
	}, [post]);

	/** Start an agent with the learner's own command (empty: the usual one again). Resolves to an error message, if any. */
	const setStartCommand = useCallback((agent: FolderAgent, command: string): Promise<WriteResult> => post({ action: "set-start-command", agent, command }), [post]);

	return { view, change, setStartCommand };
}
