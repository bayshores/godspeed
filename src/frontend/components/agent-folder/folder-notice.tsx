/**
 * Once, for people who set up godspeed the old way (the Claude Code plugin
 * or the Codex config): godspeed has its own folder now. "Set up my
 * folder" makes it, picks the agent the old setup was for and removes the
 * old setup; "Later" hides the notice for good. It opens after the welcome
 * screen (openFolderNotice), or right away without one.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { FolderAgent } from "@/shared/core";
import { usePresence } from "@/frontend/components/presence";
import { DialogSheet } from "@/frontend/components/ui/dialog-sheet";
import { useGuardedAction } from "@/frontend/components/use-guarded-action";
import { jsonInit, send } from "@/frontend/lib/api";
import { useAgentFolderView } from "./agent-folder-context";
import { AGENT_LABEL } from "./agent-folder-model";

const OPEN_EVENT = "lh:folder-notice";

export function openFolderNotice(): void {
	window.dispatchEvent(new Event(OPEN_EVENT));
}

export function FolderNotice({ agent, afterWelcome }: { agent: FolderAgent; afterWelcome: boolean }) {
	const [open, setOpen] = useState(false);
	const presence = usePresence(open);
	const { view, post, pick } = useAgentFolderView();
	const action = useGuardedAction();
	useEffect(() => {
		if (!afterWelcome) setOpen(true);
		const show = () => setOpen(true);
		window.addEventListener(OPEN_EVENT, show);
		return () => window.removeEventListener(OPEN_EVENT, show);
	}, [afterWelcome]);

	const later = () => {
		setOpen(false);
		void send("/api/agent-folder", jsonInit("POST", { action: "dismiss-notice" }));
	};
	// Lessons and chats run in the folder by themselves: nothing to start.
	const setUp = async () => {
		const made = await action.run(async () => {
			try {
				if (view?.agent !== agent) await pick(agent);
				await post({ action: "setup" });
				return null;
			} catch (err) {
				return (err as Error).message;
			}
		});
		if (made) setOpen(false);
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
					<button type="button" data-testid="folder-notice-later" className="lh-btn" onClick={later}>
						Later
					</button>
					<button
						type="button"
						data-testid="folder-notice-setup"
						disabled={action.busy}
						onClick={() => void setUp()}
						className="lh-btn lh-btn-main"
					>
						Set up my folder
					</button>
				</>
			}
		>
			<p className="text-lg text-ink">
				{name} teaches you from {view?.short ?? "~/godspeed"} now. Your other {name} chats stop loading godspeed, and your spaces and lessons stay as
				they are.
			</p>
			{action.error && (
				<p role="alert" className="text-[15px] text-ans-wrong">
					{action.error}
				</p>
			)}
		</DialogSheet>,
		document.body,
	);
}
