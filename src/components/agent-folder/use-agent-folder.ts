"use client";

import { useCallback, useEffect, useState } from "react";
import type { FolderAgent } from "@/core";
import type { FolderView, Launch } from "./agent-folder-model";

const AGENT_KEY = "lh-folder-agent";
const UNREACHABLE = "Couldn't reach godspeed. Try again.";

export async function postAgentFolder(body: object): Promise<FolderView> {
	let res: Response;
	try {
		res = await fetch("/api/agent-folder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
	} catch {
		throw new Error(UNREACHABLE);
	}
	const json = (await res.json().catch(() => ({}))) as FolderView & { error?: string };
	if (!res.ok) throw new Error(json.error ?? UNREACHABLE);
	return json;
}

/** The last agent opened from this window ("claude" when none). */
export function savedAgent(): string | null {
	try {
		return localStorage.getItem(AGENT_KEY);
	} catch {
		return null;
	}
}

/**
 * The godspeed folder and its "Open Claude Code" button: open(agent) makes
 * or updates the folder, then asks the desktop app to start the agent in a
 * terminal there (outside the desktop app, the learner runs the command).
 * `launch` is the latest click, for the live log.
 */
export function useAgentFolder() {
	const [view, setView] = useState<FolderView | null>(null);
	const [launch, setLaunch] = useState<Launch | null>(null);

	useEffect(() => {
		fetch("/api/agent-folder", { cache: "no-store" })
			.then((r) => (r.ok ? (r.json() as Promise<FolderView>) : null))
			.then((v) => v && setView(v))
			.catch(() => {/* the button sets it up on click */});
	}, []);

	const open = useCallback(async (agent: FolderAgent) => {
		try {
			localStorage.setItem(AGENT_KEY, agent);
		} catch {
			/* remembering is a convenience */
		}
		setLaunch({ agent, made: "wait" });
		let made: FolderView;
		try {
			made = await postAgentFolder({ action: "setup" });
		} catch (err) {
			setLaunch({ agent, made: { error: (err as Error).message } });
			return;
		}
		setView(made);
		const openAgent = window.lh?.openAgent;
		if (!openAgent) {
			setLaunch({ agent, made: "done", opened: "manual" });
			return;
		}
		setLaunch({ agent, made: "done", opened: "wait" });
		const error = await openAgent(made.folder, agent).catch(() => "Couldn't open a terminal. Copy the command and run it in yours.");
		setLaunch({ agent, made: "done", opened: error ? { error } : "done" });
	}, []);

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

	return { view, launch, open, change };
}
