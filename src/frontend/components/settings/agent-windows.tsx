import { DEFAULT_TEACHER_NAME } from "@/shared/core";
import { AGENT_LABEL } from "@/frontend/components/agent-folder/agent-folder-model";
import { useAgentFolderView } from "@/frontend/components/agent-folder/agent-folder-context";
import { OtherAppSetup } from "@/frontend/components/agent-folder/agent-launcher";
import { OldSetupWarning } from "@/frontend/components/agent-folder/old-setup";
import type { AgentStatus } from "@/frontend/components/agent-status";
import { CopyButton } from "@/frontend/components/copy-button";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { TeacherStatus } from "@/frontend/components/terminal/teacher-status";
import { useTerminals } from "@/frontend/components/terminal/use-terminals";
import { teacherTile, type AgentTile } from "./agent-windows-model";
import { QUIET_KEY } from "./controls.tsx";

/**
 * "Your agent": whether the teacher runs and what it is doing, the command
 * that starts the picked agent in a terminal of the learner's own, and the
 * setup for any other MCP app. The agent, its folder and its start command
 * are picked in Settings, Teacher.
 */
export function AgentWindows({ agent }: { agent: AgentStatus }) {
	const { view } = useAgentFolderView();
	const terminals = useTerminals();
	const panel = useTeacher();
	const picked = view?.agent ?? "claude";
	const teacher = teacherTile(panel?.doing ?? null, !!terminals?.outsideHere);

	return (
		<section data-testid="agent-windows" className="@container lh-sheet lh-card">
			<div className="lh-card-head">
				{/* Each tile's chip says whether it runs; the headline names the agent. */}
				<h2 data-testid="agent-status" className="lh-card-title">
					Your agent is {agent.name ?? AGENT_LABEL[picked]}
				</h2>
			</div>
			<Tile name={panel?.name ?? DEFAULT_TEACHER_NAME} tile={teacher} said={!!panel?.panelOpen} />
			{view && (
				<div className="flex justify-end">
					<CopyButton aria-label="Copy the command" className={QUIET_KEY} text={view.commands[picked]}>
						Copy the command
					</CopyButton>
				</div>
			)}
			<OldSetupWarning />
			<OtherAppSetup />
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
