import { useState } from "react";
import type { FolderAgent } from "@/shared/core";
import { AGENT_LABEL } from "./agent-folder-model";

/**
 * The box "Change command" opens: the learner's own command for starting
 * this agent, for people who start it through a launcher. Empty goes back
 * to the usual command.
 */
export function StartCommandField({ agent, saved, onSave }: { agent: FolderAgent; saved: string; onSave: (command: string) => void }) {
	const [command, setCommand] = useState(saved);
	return (
		<form
			data-testid="agent-start-command"
			className="flex w-full max-w-[560px] flex-col gap-2 text-left"
			onSubmit={(e) => {
				e.preventDefault();
				onSave(command);
			}}
		>
			<label htmlFor="agent-start-command-input" className="text-[13px] text-ink-2">
				Command that starts {AGENT_LABEL[agent]}
			</label>
			<div className="flex items-center gap-2">
				<input
					id="agent-start-command-input"
					type="text"
					autoFocus
					spellCheck={false}
					autoCapitalize="off"
					autoCorrect="off"
					value={command}
					placeholder={agent}
					onChange={(e) => setCommand(e.target.value)}
					className="h-[28px] min-w-0 flex-1 border border-tone-2 bg-background px-2 font-mono text-[12.5px] text-ink focus-visible:border-ink-3"
				/>
				<button type="submit" className="lh-press lh-btn">
					Save
				</button>
			</div>
			<p className="text-[13px] text-ink-3">
				Leave empty to use <span className="font-mono text-[12.5px]">{agent}</span>
			</p>
		</form>
	);
}
