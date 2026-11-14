import { useCallback, useEffect, useState } from "react";
import type { FolderAgent } from "@/shared/core";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { useTerminals } from "@/frontend/components/terminal/use-terminals";
import type { TerminalRole } from "@/frontend/components/terminal/terminal-model";
import { AGENT_LABEL, logLines, rememberedAgent, type FolderView, type Launch } from "./agent-folder-model";
import { postAgentFolder, saveAgent, savedAgent } from "./agent-folder-api";

/**
 * The godspeed folder and its "Start Claude Code" button: open(agent)
 * makes or updates the folder and starts the agent in a terminal inside
 * the desktop app (terminal/use-terminals.ts). Outside the desktop app the
 * learner runs the command, and `lines` is the live log of that launch.
 * openHelper starts the helper alone. `busy` while a start runs, `error`
 * when it failed.
 */
export function useAgentFolder() {
	const [view, setView] = useState<FolderView | null>(null);
	const [launch, setLaunch] = useState<Launch | null>(null);
	const [starting, setStarting] = useState(false);
	const [failed, setFailed] = useState<string | null>(null);
	const status = useAgentStatus();
	const terminals = useTerminals();

	const load = useCallback(() => {
		fetch("/api/agent-folder", { cache: "no-store" })
			.then((r) => (r.ok ? (r.json() as Promise<FolderView>) : null))
			.then((v) => v && setView(v))
			.catch(() => {/* the button sets it up on click */});
	}, []);
	useEffect(load, [load]);

	/** Resolves to true once the agent starts (or, outside the desktop app, the folder is made). */
	const start = useCallback(
		async (role: TerminalRole, agent: FolderAgent): Promise<boolean> => {
			saveAgent(agent);
			if (terminals?.available) {
				setStarting(true);
				setFailed(null);
				const why = await terminals.start(role, agent);
				setStarting(false);
				setFailed(why);
				if (!why) load();
				return !why;
			}
			const launch: Pick<Launch, "agent" | "helperOnly"> = role === "helper" ? { agent, helperOnly: true } : { agent };
			setLaunch({ ...launch, made: "wait" });
			try {
				setView(await postAgentFolder({ action: "setup" }));
				setLaunch({ ...launch, made: "done" });
				return true;
			} catch (err) {
				setLaunch({ ...launch, made: { error: (err as Error).message } });
				return false;
			}
		},
		[terminals, load],
	);

	const open = useCallback((agent: FolderAgent) => start("teacher", agent), [start]);
	/** Start the helper alone. */
	const openHelper = useCallback((agent: FolderAgent) => start("helper", agent), [start]);

	/** Use another folder (the native picker); null when cancelled. Resolves to an error message, if any. */
	const change = useCallback(async (): Promise<string | null> => {
		const folder = await window.lh?.pickFolder?.();
		if (!folder) return null;
		try {
			setView(await postAgentFolder({ action: "setup", folder }));
			setLaunch(null);
			return null;
		} catch (err) {
			return (err as Error).message;
		}
	}, []);

	/** Start an agent with the learner's own command (empty: the usual one again). Resolves to an error message, if any. */
	const setStartCommand = useCallback(async (agent: FolderAgent, command: string): Promise<string | null> => {
		try {
			setView(await postAgentFolder({ action: "set-start-command", agent, command }));
			return null;
		} catch (err) {
			return (err as Error).message;
		}
	}, []);

	const lines = launch && view ? logLines(launch, { connected: !!status?.connected, teaching: !!status?.teaching, helperHere: !!status?.helperHere }, view.short) : [];
	const busy = starting || launch?.made === "wait";
	const error = failed ?? (typeof launch?.made === "object" ? launch.made.error : null);
	/** Outside the desktop app the folder is made: the learner runs the command. */
	const manual = launch?.made === "done";

	return { view, lines, busy, error, manual, open, openHelper, change, setStartCommand };
}

/** "Start Claude Code" for the agent last started here (Claude Code when
 *  none): the button on the "No agent connected" lines. `starting` while
 *  godspeed's own teacher runs but has not connected: the teacher's status
 *  line says so, and the lines show nothing. */
export function useStartAgent() {
	const { busy, error, manual, open } = useAgentFolder();
	const [agent, setAgent] = useState<FolderAgent>("claude");
	useEffect(() => setAgent(rememberedAgent(savedAgent())), []);
	const teacher = useTerminals()?.teacher;
	return { label: `Start ${AGENT_LABEL[agent]}`, start: () => void open(agent), busy, error, manual, starting: !!teacher && !teacher.ended };
}
