import { useState, type ReactNode } from "react";
import type { FolderAgent } from "@/shared/core";
import { CopyButton } from "@/frontend/components/copy-button";
import { QUIET_KEY } from "@/frontend/components/settings/controls";
import { cn } from "@/frontend/lib/utils";
import type { FolderView } from "./agent-folder-model";
import { StartCommandField } from "./start-command-field";

/**
 * The godspeed folder as one quiet line: where it is, then buttons to
 * change it, copy the command or change the command that starts the agent.
 * `children` name the folder. Errors go to `onError` (null clears).
 */
export function FolderLine({
	agent,
	view,
	change,
	setStartCommand,
	onError,
	children,
}: {
	agent: FolderAgent;
	view: FolderView | null;
	change: () => Promise<string | null>;
	setStartCommand: (agent: FolderAgent, command: string) => Promise<string | null>;
	onError: (error: string | null) => void;
	children: ReactNode;
}) {
	const [changingCommand, setChangingCommand] = useState(false);
	const canChange = typeof window !== "undefined" && !!window.lh?.pickFolder;
	if (!view && !canChange) return null;
	return (
		<>
			<div className="flex w-full flex-wrap items-center gap-x-3.5 gap-y-1">
				{view && (
					<span className="mr-auto flex items-center gap-2 text-[15px] text-ink-2" data-testid="agent-folder-path">
						{children}
					</span>
				)}
				{canChange && (
					<button type="button" data-testid="agent-folder-change" className={cn(QUIET_KEY, !view && "ml-auto")} onClick={() => void change().then(onError)}>
						Change folder
					</button>
				)}
				{view && (
					<CopyButton aria-label="Copy the command" className={QUIET_KEY} text={view.commands[agent]}>
						Copy the command
					</CopyButton>
				)}
				{view && (
					<button type="button" data-testid="agent-start-command-change" aria-expanded={changingCommand} className={QUIET_KEY} onClick={() => setChangingCommand(!changingCommand)}>
						Change command
					</button>
				)}
			</div>
			{view && changingCommand && (
				<StartCommandField
					agent={agent}
					saved={view.startCommands[agent] ?? ""}
					onSave={(command) =>
						void setStartCommand(agent, command).then((failed) => {
							onError(failed);
							if (!failed) setChangingCommand(false);
						})
					}
				/>
			)}
		</>
	);
}
