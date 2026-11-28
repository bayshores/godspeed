/**
 * Settings → Teacher: "Your teacher", the setup card, then what only Settings sets: the teacher's
 * name, the godspeed folder and the learner's own command for starting the agent.
 */

import { useState } from "react";
import { DEFAULT_TEACHER_NAME, type UserSettings } from "@/shared/core";
import { useAgentFolder } from "@/frontend/components/agent-folder/use-agent-folder";
import { StartCommandField } from "@/frontend/components/agent-folder/start-command-field";
import { AgentCard } from "@/frontend/components/agent-setup/agent-card";
import { usePickedAgent } from "@/frontend/components/agent-setup/agent-setup-context";
import type { GeneralPatch } from "@/frontend/components/settings-context";
import { useFold } from "@/frontend/components/use-fold";
import { CommitInput, QUIET_KEY, SettingsRow } from "./controls.tsx";
import { ErrorLine } from "@/frontend/components/error-line";

export function TeacherSection({ record, onGeneralChange }: { record: UserSettings; onGeneralChange: (fields: GeneralPatch) => void }) {
	return (
		// Wide, the card takes the first of two columns, as General's groups do.
		<div className="grid items-start gap-(--lh-gap) @[1000px]/page:grid-cols-2">
			<section data-testid="group-teacher" className="lh-sheet lh-card">
				<div className="lh-card-head">
					<h2 className="lh-card-title">Your teacher</h2>
				</div>
				<AgentCard
					foot={
						<div className="flex flex-col">
							<SettingsRow label="Name" testid="teacher-name-row">
								<CommitInput
									value={record.general?.teacherName ?? ""}
									placeholder={DEFAULT_TEACHER_NAME}
									ariaLabel="Teacher name"
									testid="teacher-name"
									onCommit={(next) => onGeneralChange({ teacherName: next || null })}
								/>
							</SettingsRow>
							<FolderRows />
						</div>
					}
				/>
			</section>
		</div>
	);
}

/** "Folder" with its path and Change folder, and "Start command" with the command and Change. */
function FolderRows() {
	const { view, change, setStartCommand } = useAgentFolder();
	const agent = usePickedAgent();
	const [changing, setChanging] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const field = useFold(changing);
	const canChange = typeof window !== "undefined" && !!window.lh?.pickFolder;
	if (!view) return null;
	return (
		<>
			<SettingsRow label="Folder" testid="agent-folder-row">
				<span className="flex items-center gap-3">
					<span data-testid="agent-folder-path" className="text-ui text-ink-2">
						{view.short}
					</span>
					{canChange && (
						<button type="button" data-testid="agent-folder-change" className={QUIET_KEY} onClick={() => void change().then(setError)}>
							Change folder
						</button>
					)}
				</span>
			</SettingsRow>
			<SettingsRow label="Start command" testid="agent-start-command-row">
				<span className="flex items-center gap-3">
					<span className="font-mono text-ui text-ink-2">{view.startCommands[agent] ?? agent}</span>
					<button type="button" data-testid="agent-start-command-change" aria-expanded={changing} className={QUIET_KEY} onClick={() => setChanging(!changing)}>
						Change
					</button>
				</span>
			</SettingsRow>
			{field.mounted && (
				<div className="lh-collapse" data-state={field.state}>
					<div className="pb-3">
						<StartCommandField
							agent={agent}
							saved={view.startCommands[agent] ?? ""}
							onSave={(command) =>
								void setStartCommand(agent, command).then((failed) => {
									setError(failed);
									if (!failed) setChanging(false);
								})
							}
						/>
					</div>
				</div>
			)}
			<ErrorLine error={error} className="text-ui text-ans-wrong" />
		</>
	);
}
