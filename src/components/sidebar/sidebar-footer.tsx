import { SettingsIcon } from "lucide-react";
import { useActivity } from "@/components/activity-dock";
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
 * jobs); otherwise it opens Settings → Connection to set one up.
 */

export function SidebarFooter() {
	const { feed } = useActivity();
	const jobs = feed.jobs.length + feed.extractions.length;
	const agent = useAgentStatus();
	const halley = useHalley();
	const { open: openSettings } = useSettingsDialog();
	const open = halley?.panelOpen ?? false;
	const teaching = agent?.teaching ?? false;

	return (
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
	);
}
