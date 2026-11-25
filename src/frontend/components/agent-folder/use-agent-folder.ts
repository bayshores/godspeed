import { useCallback, useState } from "react";
import type { FolderAgent } from "@/shared/core";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { useTerminals } from "@/frontend/components/terminal/use-terminals";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { logLines, type Launch, type LaunchChoice } from "./agent-folder-model";
import { useAgentFolderView } from "./agent-folder-context";

/** A pick the server did not take shows as the agent it still has; this says where it failed. */
const logPickFailure = (err: unknown) => console.error("[agent folder] the picked agent could not be saved:", err);

/**
 * The godspeed folder and its "Start Claude Code" button: open(agent)
 * makes or updates the folder and starts the agent in a terminal inside
 * the desktop app (terminal/use-terminals.ts), and the teacher's start
 * opens the teacher's panel, so the learner sees it start. Outside the desktop app the
 * learner runs the command, and `lines` is the live log of that launch.
 * `busy` while a start runs, `error` when it failed.
 */
export function useAgentFolder() {
	const { view, reload, post, pick } = useAgentFolderView();
	const [launch, setLaunch] = useState<Launch | null>(null);
	const [starting, setStarting] = useState(false);
	const [failed, setFailed] = useState<string | null>(null);
	const status = useAgentStatus();
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

	const lines = launch && view ? logLines(launch, !!status?.connected, view.short) : [];
	const busy = starting || launch?.made === "wait";
	const error = failed ?? (typeof launch?.made === "object" ? launch.made.error : null);
	/** Outside the desktop app the folder is made: the learner runs the command. */
	const manual = launch?.made === "done";

	return { view, lines, busy, error, manual, open, change, setStartCommand };
}

/** The agent picked beside "Use another agent": the server's (Claude Code before a pick), which a
 *  pick of another agent changes. "Other app" is a pick of this window only. */
export function useAgentChoice() {
	const { view, pick } = useAgentFolderView();
	const [other, setOther] = useState(false);
	const choice: LaunchChoice = other ? "other" : (view?.agent ?? "claude");
	const setChoice = useCallback(
		(next: LaunchChoice) => {
			setOther(next === "other");
			if (next !== "other" && next !== view?.agent) void pick(next).catch(logPickFailure);
		},
		[pick, view?.agent],
	);
	return [choice, setChoice] as const;
}
