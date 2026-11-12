import { useState } from "react";
import { FIELD } from "@/frontend/components/ui/field";
import { LABEL_TEXT } from "@/frontend/components/ui/label-text";
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
			className="flex w-full flex-col gap-1.5 text-left"
			onSubmit={(e) => {
				e.preventDefault();
				onSave(command);
			}}
		>
			<label htmlFor="agent-start-command-input" className={LABEL_TEXT}>
				Command that starts {AGENT_LABEL[agent]}
			</label>
			<div className="flex items-center gap-2.5">
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
					className={`${FIELD} min-w-0 flex-1 font-mono`}
				/>
				<button type="submit" className="lh-btn lh-btn-main h-10 shrink-0 text-[15px]">
					Save
				</button>
			</div>
			<p className="text-[15px] text-ink-2">
				Leave empty to use <span className="font-mono">{agent}</span>
			</p>
		</form>
	);
}
