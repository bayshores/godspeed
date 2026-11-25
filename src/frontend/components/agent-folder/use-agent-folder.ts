import { useCallback } from "react";
import type { FolderAgent } from "@/shared/core";
import { useAgentFolderView } from "./agent-folder-context";

/** The godspeed folder in Settings, Teacher: change() picks another folder, setStartCommand() saves
 *  the learner's own command for starting the agent. */
export function useAgentFolder() {
	const { view, post } = useAgentFolderView();

	/** Use another folder (the native picker); null when cancelled. Resolves to an error message, if any. */
	const change = useCallback(async (): Promise<string | null> => {
		const folder = await window.lh?.pickFolder?.();
		if (!folder) return null;
		try {
			await post({ action: "setup", folder });
			return null;
		} catch (err) {
			return (err as Error).message;
		}
	}, [post]);

	/** Start an agent with the learner's own command (empty: the usual one again). Resolves to an error message, if any. */
	const setStartCommand = useCallback(async (agent: FolderAgent, command: string): Promise<string | null> => {
		try {
			await post({ action: "set-start-command", agent, command });
			return null;
		} catch (err) {
			return (err as Error).message;
		}
	}, [post]);

	return { view, change, setStartCommand };
}
