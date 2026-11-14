import { useEffect, useState } from "react";
import { DEFAULT_TEACHER_NAME } from "@/shared/core";
import { useActivity } from "@/frontend/components/activity-dock";
import { AGENT_LABEL, rememberedAgent, type LaunchChoice } from "@/frontend/components/agent-folder/agent-folder-model";
import { Log, OtherAppSetup } from "@/frontend/components/agent-folder/agent-launcher";
import { FolderLine } from "@/frontend/components/agent-folder/folder-line";
import { OldSetupWarning } from "@/frontend/components/agent-folder/old-setup";
import { AgentMenu } from "@/frontend/components/agent-folder/start-agent-button";
import { savedAgent } from "@/frontend/components/agent-folder/agent-folder-api";
import { useAgentFolder } from "@/frontend/components/agent-folder/use-agent-folder";
import type { AgentStatus } from "@/frontend/components/agent-status";
import { backgroundLine } from "@/frontend/components/teacher/follow-status";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { useSpaces } from "@/frontend/components/space-context";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { TeacherStatus } from "@/frontend/components/terminal/teacher-status";
import { useTerminals } from "@/frontend/components/terminal/use-terminals";
import { HELPER_NAME, filesProgress } from "@/frontend/components/work/work-model";
import { cn } from "@/frontend/lib/utils";
import { agentHeadline, filesLine, helperTile, teacherTile, type AgentTile, type TermState } from "./agent-windows-model";

/**
 * "Your agent": whether the teacher and the helper run and what each is
 * doing. The teacher's tile carries the button that starts it; the
 * helper's only when godspeed can't start it by itself. The teacher's
 * line shows its screen while godspeed runs it. Under the tiles, the
 * folder they run in. "Other app" shows the setup for any MCP app.
 */
export function AgentWindows({ agent }: { agent: AgentStatus }) {
	const { view, lines, busy, error: startError, open, openHelper, change, setStartCommand } = useAgentFolder();
	const terminals = useTerminals();
	const outside = !!terminals?.outsideHere;
	const panel = useTeacher();
	const { spaces } = useSpaces();
	const { feed } = useActivity();
	const [choice, setChoice] = useState<LaunchChoice>("claude");
	const [error, setError] = useState<string | null>(null);
	useEffect(() => setChoice(rememberedAgent(savedAgent())), []);

	const folderAgent = choice === "other" ? null : choice;
	const teacherName = panel?.name ?? DEFAULT_TEACHER_NAME;
	const { left: filesLeft } = filesProgress(spaces);
	const ownTeacher = terminals?.teacher ?? null;
	const ownHelper = terminals?.helper ?? null;
	const teacherLive = !!ownTeacher && !ownTeacher.ended;
	const teacherTerm: TermState = !ownTeacher ? null : ownTeacher.ended ? "ended" : terminals?.facts.teacher?.here ? null : "starting";
	// A helper that ended with its teacher starts again by itself with the next one.
	const helperTerm: TermState = !ownHelper ? null : !ownHelper.ended ? (agent.helperHere ? null : "starting") : teacherLive ? "ended" : null;
	const teacher = teacherTile(agent, panel?.doing ?? null, { outside, term: teacherTerm });
	const helper = helperTile({
		agent,
		background: backgroundLine(feed.extractions, feed.jobs),
		files: filesLine(spaces),
		filesLeft,
		teacher: teacherName,
		term: helperTerm,
		autoStart: !!terminals?.available && !outside,
	});

	return (
		<section data-testid="agent-windows" className="flex flex-col gap-5 rounded border-2 border-line bg-panel p-6">
			<div className="flex flex-wrap items-start gap-x-4 gap-y-2">
				<div className="min-w-0 flex-1">
					<h2 data-testid="agent-status" className="text-[28px] leading-tight text-ink">
						{agentHeadline(agent, teacherName, teacherTerm === "starting")}
					</h2>
					<p className="text-[15px] text-ink-2">Your agent is {agent.name ?? (folderAgent ? AGENT_LABEL[folderAgent] : "another app")}</p>
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
			<div className="grid gap-4 min-[860px]:grid-cols-2">
				<Tile id="teacher" name="Teacher" icon="window" tile={teacher} onOpen={folderAgent && (() => void open(folderAgent))} busy={busy} status={teacherName} />
				<Tile id="helper" name={HELPER_NAME} icon="pages" tile={helper} onOpen={folderAgent && (() => void openHelper(folderAgent))} busy={busy} quiet />
			</div>
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

const CHIP: Record<string, string> = {
	Teaching: "bg-ans-right text-background",
	Running: "bg-ans-right text-background",
	"Not running": "bg-tone text-ink",
	Stopped: "bg-tone text-ink",
};

/** One agent: its icon, name and status chip, then what it is doing.
 *  `status`: the teacher's name, for its status line (TeacherStatus).
 *  `quiet`: its button is a plain word (the helper is never the main thing). */
function Tile({
	id,
	name,
	icon,
	tile,
	onOpen,
	busy,
	status,
	quiet = false,
}: {
	id: string;
	name: string;
	icon: "window" | "pages";
	tile: AgentTile;
	onOpen: (() => void) | null;
	busy: boolean;
	status?: string;
	quiet?: boolean;
}) {
	const off = tile.tone === "off";
	return (
		<div data-testid={`agent-window-${id}`} data-tone={tile.tone} className={cn("flex min-w-0 flex-col border-2", off ? "border-edge" : "border-line bg-background")}>
			<div aria-hidden data-state={tile.tone === "busy" ? "working" : undefined} className={cn("h-3 shrink-0", tile.tone === "busy" ? "lh-work-stripes" : off ? "bg-tone-2" : "bg-ink")} />
			<div className="flex min-w-0 items-start gap-4 p-4">
				<span aria-hidden className={cn("flex size-16 shrink-0 items-center justify-center", tile.tone === "busy" ? "bg-highlight text-ink" : off ? "bg-tone text-ink-2" : "bg-ink text-background")}>
					<PixelIcon name={icon} className="h-9" />
				</span>
				<div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
					<div className="flex items-center gap-2.5">
						<h3 className={cn("text-[22px] leading-tight", off ? "text-ink-2" : "text-ink")}>{name}</h3>
						<span data-testid={`agent-window-${id}-chip`} className={cn("px-2 py-0.5 text-sm", CHIP[tile.chip] ?? "bg-highlight text-ink")}>
							{tile.chip}
						</span>
					</div>
					{status ? (
						<TeacherStatus name={status} line={tile.line} testid={`agent-window-${id}-line`} className={cn("max-w-full truncate text-base", off ? "text-ink-2" : "text-ink")} />
					) : (
						tile.line && (
							<p data-testid={`agent-window-${id}-line`} title={tile.line} className={cn("max-w-full truncate text-base", off ? "text-ink-2" : "text-ink")}>
								{tile.line}
							</p>
						)
					)}
					<p className="text-[15px] text-ink-2">{tile.note}</p>
					{tile.start && onOpen && (
						<button type="button" data-testid={`agent-window-${id}-open`} disabled={busy} onClick={onOpen} className={cn("lh-btn mt-2", quiet ? "lh-btn-quiet -ml-1.5" : "lh-btn-main")}>
							{tile.start}
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
