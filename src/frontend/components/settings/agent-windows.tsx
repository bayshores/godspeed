import { useState } from "react";
import { DEFAULT_TEACHER_NAME } from "@/shared/core";
import { AGENT_LABEL } from "@/frontend/components/agent-folder/agent-folder-model";
import { Log, OtherAppSetup } from "@/frontend/components/agent-folder/agent-launcher";
import { FolderLine } from "@/frontend/components/agent-folder/folder-line";
import { OldSetupWarning } from "@/frontend/components/agent-folder/old-setup";
import { AgentMenu } from "@/frontend/components/agent-folder/start-agent-button";
import { useAgentChoice, useAgentFolder } from "@/frontend/components/agent-folder/use-agent-folder";
import type { AgentStatus } from "@/frontend/components/agent-status";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { TeacherStatus } from "@/frontend/components/terminal/teacher-status";
import { useTerminals } from "@/frontend/components/terminal/use-terminals";
import { teacherTile, type AgentTile } from "./agent-windows-model";

/**
 * "Your agent": whether the teacher runs and what it is doing. The teacher
 * starts from its own window, so its tile has no button. Its line shows its
 * screen while godspeed runs it. Under the tile, the folder it runs in.
 * "Other app" shows the setup for any MCP app.
 */
export function AgentWindows({ agent }: { agent: AgentStatus }) {
	const { view, lines, error: startError, change, setStartCommand } = useAgentFolder();
	const terminals = useTerminals();
	const outside = !!terminals?.outsideHere;
	const panel = useTeacher();
	const [choice, setChoice] = useAgentChoice();
	const [error, setError] = useState<string | null>(null);

	const folderAgent = choice === "other" ? null : choice;
	const teacherName = panel?.name ?? DEFAULT_TEACHER_NAME;
	const teacher = teacherTile(panel?.doing ?? null, outside);

	return (
		<section data-testid="agent-windows" className="@container lh-sheet lh-card">
			<div className="lh-card-head">
				<div className="min-w-0 flex-1">
					{/* Each tile's chip says whether it runs; the headline names the agent. */}
					<h2 data-testid="agent-status" className="lh-card-title">
						Your agent is {agent.name ?? (folderAgent ? AGENT_LABEL[folderAgent] : "another app")}
					</h2>
				</div>
				<AgentMenu
					choice={choice}
					onChoose={(c) => {
						setChoice(c);
						setError(null);
					}}
					className="shrink-0"
				/>
			</div>
			<Tile name={teacherName} tile={teacher} said={!!panel?.panelOpen} />
			<OldSetupWarning />
			{choice === "other" ? <OtherAppSetup /> : lines.length > 0 && <Log lines={lines} />}
			{(error ?? (lines.length === 0 && startError)) && (
				<p role="alert" className="text-[15px] text-ans-wrong">
					{error ?? startError}
				</p>
			)}
			{folderAgent && (
				<FolderLine key={folderAgent} agent={folderAgent} view={view} change={change} setStartCommand={setStartCommand} onError={setError}>
					<PixelIcon name="folder" className="h-3" />
					{view?.short}
				</FolderLine>
			)}
		</section>
	);
}


/** The teacher: its icon, name and status chip, then what it is doing.
 *  `said`: the teacher's open panel beside it says its status, so the
 *  tile leaves out its chip and line. */
function Tile({ name, tile, said }: { name: string; tile: AgentTile; said: boolean }) {
	return (
		<div data-testid="agent-window-teacher" className="lh-well flex min-w-0 flex-col overflow-hidden rounded">
			<div aria-hidden className="h-3 shrink-0 bg-ink" />
			<div className="flex min-w-0 items-start gap-4 p-4">
				<span aria-hidden className="flex size-16 shrink-0 items-center justify-center bg-ink text-background">
					<PixelIcon name="window" className="h-9" />
				</span>
				<div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
					<div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
						<h3 className="text-[22px] leading-tight text-ink">{name}</h3>
						{!said && (
							<span data-testid="agent-window-teacher-chip" className="bg-ans-right px-2 py-0.5 text-sm text-background">
								{tile.chip}
							</span>
						)}
					</div>
					{!said && <TeacherStatus name={name} line={tile.line} testid="agent-window-teacher-line" className="max-w-full truncate text-base text-ink" />}
					<p className="text-[15px] text-ink-2">{tile.note}</p>
				</div>
			</div>
		</div>
	);
}
