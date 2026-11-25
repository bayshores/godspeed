import { useCallback, useState } from "react";
import type { FolderAgent } from "@/shared/core";
import { useTerminals } from "@/frontend/components/terminal/use-terminals";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import type { Launch } from "./agent-folder-model";
import { useAgentFolderView } from "./agent-folder-context";

/** A pick the server did not take shows as the agent it still has; this says where it failed. */
const logPickFailure = (err: unknown) => console.error("[agent folder] the picked agent could not be saved:", err);

/**
 * The godspeed folder: open(agent) makes or updates it and starts the agent
 * in a terminal inside the desktop app (terminal/use-terminals.ts), then
 * opens the teacher's panel. Outside the desktop app the folder is made
 * (`manual`) and the learner runs the command. `busy` while a start runs,
 * `error` when it failed. change() picks another folder, setStartCommand()
 * saves the learner's own command.
 */
export function useAgentFolder() {
	const { view, reload, post, pick } = useAgentFolderView();
	const [launch, setLaunch] = useState<Launch | null>(null);
	const [starting, setStarting] = useState(false);
	const [failed, setFailed] = useState<string | null>(null);
	const terminals = useTerminals();
	const showChat = useTeacher()?.showChat;

	/** Resolves to true once the agent starts (or, outside the desktop app, the folder is made). */
	const open = useCallback(
		async (agent: FolderAgent): Promise<boolean> => {
			if (view?.agent !== agent) void pick(agent).catch(logPickFailure);
			if (terminals?.available) {
				setStarting(true);
				setFailed(null);
				const why = await terminals.start(agent);
				setStarting(false);
				setFailed(why);
				if (!why) void reload();
				if (!why) showChat?.();
				return !why;
			}
			setLaunch({ agent, made: "wait" });
			try {
				await post({ action: "setup" });
				setLaunch({ agent, made: "done" });
				return true;
			} catch (err) {
				setLaunch({ agent, made: { error: (err as Error).message } });
				return false;
			}
		},
		[terminals, reload, post, pick, view?.agent, showChat],
	);


	/** Use another folder (the native picker); null when cancelled. Resolves to an error message, if any. */
	const change = useCallback(async (): Promise<string | null> => {
		const folder = await window.lh?.pickFolder?.();
		if (!folder) return null;
		try {
			await post({ action: "setup", folder });
			setLaunch(null);
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

	const busy = starting || launch?.made === "wait";
	const error = failed ?? (typeof launch?.made === "object" ? launch.made.error : null);
	/** Outside the desktop app the folder is made: the learner runs the command. */
	const manual = launch?.made === "done";

	return { view, busy, error, manual, open, change, setStartCommand };
}
