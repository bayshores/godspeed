/**
 * Once, for people who set up godspeed the old way (the Claude Code plugin
 * or the Codex config): godspeed has its own folder now. "Set up my
 * folder" makes it, removes the old setup and starts the agent there;
 * "Later" hides the notice for good. It opens after
 * the welcome screen (openFolderNotice), or right away without one.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { FolderAgent } from "@/shared/core";
import { usePresence } from "@/frontend/components/presence";
import { DialogSheet } from "@/frontend/components/ui/dialog-sheet";
import { AGENT_LABEL } from "./agent-folder-model";
import { useAgentFolder } from "./use-agent-folder";

const OPEN_EVENT = "lh:folder-notice";

export function openFolderNotice(): void {
	window.dispatchEvent(new Event(OPEN_EVENT));
}

export function FolderNotice({ agent, afterWelcome }: { agent: FolderAgent; afterWelcome: boolean }) {
	const [open, setOpen] = useState(false);
	const presence = usePresence(open);
	const { view, busy, error, open: startAgent } = useAgentFolder();
	useEffect(() => {
		if (!afterWelcome) setOpen(true);
		const show = () => setOpen(true);
		window.addEventListener(OPEN_EVENT, show);
		return () => window.removeEventListener(OPEN_EVENT, show);
	}, [afterWelcome]);

	const later = () => {
		setOpen(false);
		void fetch("/api/agent-folder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "dismiss-notice" }) }).catch(() => {});
	};
	// Close once the agent starts; the teacher's status line follows it from there.
	const setUp = async () => {
		if (await startAgent(agent)) setOpen(false);
	};
	const name = AGENT_LABEL[agent];

	if (!presence.mounted || typeof document === "undefined") return null;
	return createPortal(
		<DialogSheet
			title="godspeed has its own folder now"
			state={presence.state}
			testid="folder-notice"
			onClose={() => setOpen(false)}
			foot={
				<>
					<span className="flex-1" />
					<button type="button" data-testid="folder-notice-later" className="lh-btn text-[15px]" onClick={later}>
						Later
					</button>
					<button
						type="button"
						data-testid="folder-notice-setup"
						disabled={busy}
						onClick={() => void setUp()}
						className="lh-btn lh-btn-main text-[15px]"
					>
						Set up my folder
					</button>
				</>
			}
		>
			<p className="text-lg text-ink">
				Start {name} in {view?.short ?? "~/godspeed"} to study. Your other {name} chats stop loading godspeed, and your spaces and lessons stay as
				they are.
			</p>
			{error && (
				<p role="alert" className="text-[15px] text-ans-wrong">
					{error}
				</p>
			)}
		</DialogSheet>,
		document.body,
	);
}
