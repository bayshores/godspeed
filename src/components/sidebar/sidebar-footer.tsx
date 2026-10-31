import { useEffect, useState } from "react";
import { SettingsIcon, SquareTerminalIcon } from "lucide-react";
import type { FolderAgent } from "@/core";
import { useActivity } from "@/components/activity-dock";
import { AGENT_LABEL, rememberedAgent } from "@/components/agent-folder/agent-folder-model";
import { savedAgent, useAgentFolder } from "@/components/agent-folder/use-agent-folder";
import { footerLabel, teachStep, useAgentStatus } from "@/components/agent-status";
import { useHalley } from "@/components/halley/halley-provider";
import { useSettingsDialog } from "@/components/settings/settings-dialog-provider.tsx";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";

/**
 * THE SIDEBAR FOOTER: a dot and one line — the
 * outside agent and how many background jobs run ("Claude Code · 1 job")
 * — plus the settings icon. The dot is green while an outside agent is
 * connected over MCP (src/components/agent-status.tsx). While an agent
 * teaches, clicking the line opens Halley's panel (Now, Recent, Background
 * jobs); otherwise it opens Settings → Connection to set one up. While no
 * agent is connected, a box above it opens the last one used in the
 * godspeed folder.
 */

function ReopenAgent() {
	const { launch, open } = useAgentFolder();
	const [agent, setAgent] = useState<FolderAgent>("claude");
	useEffect(() => setAgent(rememberedAgent(savedAgent())), []);
	const error = typeof launch?.made === "object" ? launch.made.error : typeof launch?.opened === "object" ? launch.opened.error : null;
	const busy = !!launch && (launch.made === "wait" || launch.opened === "wait");
	return (
		<div data-testid="sidebar-reopen" className="mx-2.5 mt-2 flex flex-col gap-2.5 border border-tone-2 bg-panel p-3">
			<span className="flex items-center gap-2 text-[13px] text-ink-2">
				<span aria-hidden className="size-[7px] shrink-0 rounded-full bg-ink-3" />
				{AGENT_LABEL[agent]} isn&apos;t open
			</span>
			<button
				type="button"
				data-testid="sidebar-reopen-open"
				disabled={busy}
				onClick={() => void open(agent)}
				className="lh-press flex items-center justify-center gap-2 bg-ink px-3 py-2 text-[13px] font-bold text-background hover:bg-ink-max disabled:opacity-60"
			>
				<SquareTerminalIcon className="size-3.5" aria-hidden />
				Open in godspeed folder
			</button>
			{error && (
				<p role="alert" className="text-[12px] text-ans-wrong">
					{error}
				</p>
			)}
			{launch?.opened === "manual" && <p className="text-[12px] text-ink-3">Run the command from Settings, Connection in your terminal.</p>}
		</div>
	);
}

export function SidebarFooter() {
	const { feed } = useActivity();
	const jobs = feed.jobs.length + feed.extractions.length;
	const agent = useAgentStatus();
	const halley = useHalley();
	const { open: openSettings } = useSettingsDialog();
	const open = halley?.panelOpen ?? false;
	const teaching = agent?.teaching ?? false;

	return (
		<>
		{agent && !agent.connected && <ReopenAgent />}
		<div className="flex w-full items-center justify-between gap-2 px-2.5 pt-2">
			<button
				type="button"
				data-testid="sidebar-agent"
				data-halley-panel-toggle={teaching ? "" : undefined}
				aria-expanded={teaching ? open : undefined}
				onClick={() => (teaching ? halley?.setPanelOpen(!open) : openSettings("connection"))}
				title={agent && !teaching && (agent.connected || agent.pendingWork > 0) ? teachStep(agent.name) : undefined}
				className="lh-press flex min-w-0 items-center gap-[7px] text-[12.5px] text-ink-2 hover:text-ink"
			>
				<span
					data-testid="sidebar-agent-dot"
					data-on={agent?.connected || undefined}
					className={cn("size-[7px] shrink-0 rounded-full", agent?.connected ? "bg-ans-right" : "bg-ink-3")}
					aria-hidden
				/>
				<span className="truncate">{footerLabel(agent, jobs)}</span>
			</button>
			<Hint label="Settings" side="right">
				<button
					type="button"
					onClick={() => openSettings()}
					data-testid="settings-entry"
					aria-label="Settings"
					className="lh-press flex size-6 shrink-0 items-center justify-center text-ink-2 hover:text-ink"
				>
					<SettingsIcon className="size-4" />
				</button>
			</Hint>
		</div>
		</>
	);
}
