"use client";

/**
 * Once, for people who set up godspeed the old way (the Claude Code plugin
 * or the Codex config): godspeed has its own folder now. "Set up my
 * folder" makes it, removes the old setup and opens the agent there;
 * "Later" hides the notice for good. It opens after
 * the welcome screen (openFolderNotice), or right away without one.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { FolderAgent } from "@/core";
import { usePresence } from "@/components/presence";
import { AGENT_LABEL } from "./agent-folder-model";
import { useAgentFolder } from "./use-agent-folder";

const OPEN_EVENT = "lh:folder-notice";

export function openFolderNotice(): void {
	window.dispatchEvent(new Event(OPEN_EVENT));
}

export function FolderNotice({ agent, afterWelcome }: { agent: FolderAgent; afterWelcome: boolean }) {
	const [open, setOpen] = useState(false);
	const presence = usePresence(open);
	const { view, launch, open: openAgent } = useAgentFolder();
	useEffect(() => {
		if (!afterWelcome) setOpen(true);
		const show = () => setOpen(true);
		window.addEventListener(OPEN_EVENT, show);
		return () => window.removeEventListener(OPEN_EVENT, show);
	}, [afterWelcome]);
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopPropagation();
			setOpen(false);
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open]);
	// Close once the terminal is open; the sidebar follows the agent from there.
	useEffect(() => {
		if (launch?.opened === "done" || launch?.opened === "manual") setOpen(false);
	}, [launch]);

	const later = () => {
		setOpen(false);
		void fetch("/api/agent-folder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "dismiss-notice" }) }).catch(() => {});
	};
	const error = typeof launch?.made === "object" ? launch.made.error : typeof launch?.opened === "object" ? launch.opened.error : null;
	const busy = !!launch && !error && launch.opened !== "done";
	const name = AGENT_LABEL[agent];

	if (!presence.mounted || typeof document === "undefined") return null;
	return createPortal(
		<div
			role="dialog"
			aria-modal="true"
			aria-label="godspeed has its own folder now"
			data-testid="folder-notice"
			data-state={presence.state}
			inert={presence.state === "closed"}
			className="lh-fade fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
		>
			<div data-state={presence.state} className="lh-dialog mx-4 w-full max-w-[500px] border border-tone-2 bg-panel p-7 shadow-lg">
				<h2 className="font-title text-[26px] leading-tight text-ink">godspeed has its own folder now</h2>
				<p className="mt-2.5 text-[14.5px] leading-relaxed text-ink-2">
					Open {name} in {view?.short ?? "~/godspeed"} to study. Your other {name} chats stop loading godspeed, and your classes and lessons
					stay as they are.
				</p>
				{error && (
					<p role="alert" className="mt-3 text-[13px] text-ans-wrong">
						{error}
					</p>
				)}
				<div className="mt-6 flex items-center justify-end gap-5">
					<button type="button" data-testid="folder-notice-later" className="lh-press text-[14px] font-bold text-ink-2 hover:text-ink" onClick={later}>
						Later
					</button>
					<button
						type="button"
						data-testid="folder-notice-setup"
						disabled={busy}
						onClick={() => void openAgent(agent)}
						className="lh-press bg-ink px-[18px] py-2.5 text-[14px] font-bold text-background hover:bg-ink-max disabled:opacity-60"
					>
						Set up my folder
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
