import { useEffect, useRef, useState } from "react";
import { SettingsIcon } from "lucide-react";
import { ActivitySection, useActivity } from "@/components/activity-dock";
import { MenuShell } from "@/components/menu-shell";
import { useServerResync } from "@/components/server-events";
import { useSettingsDialog } from "@/components/settings/settings-dialog-provider.tsx";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";

/**
 * THE SIDEBAR FOOTER (redesign 2026-10-27): a dot and one line — the
 * outside agent and how many background jobs run ("Claude Code · 1 job")
 * — plus the settings icon. The dot is green while an outside agent is
 * connected over MCP. Clicking the line opens the background-jobs list
 * (the activity section) above it.
 */

export interface AgentStatus {
	/** Outside-agent access is turned on (Settings → Agents). */
	enabled: boolean;
	/** An agent asked for work recently. */
	connected: boolean;
	/** The agent's name, when the server knows it. */
	name?: string;
}

/** The footer line. Pure — exported for tests. */
export function footerLabel(agent: AgentStatus | null, jobs: number): string {
	const who = agent?.connected ? agent.name?.trim() || "Outside agent" : "No agent connected";
	return jobs > 0 ? `${who} · ${jobs} job${jobs === 1 ? "" : "s"}` : who;
}

/** The outside-agent status, read when activity moves (agent work starts
 *  and ends as jobs), on reconnect, and when the window comes back. */
function useAgentStatus(activityKey: unknown): AgentStatus | null {
	const [status, setStatus] = useState<AgentStatus | null>(null);
	const [nonce, setNonce] = useState(0);
	useServerResync(() => setNonce((n) => n + 1));
	useEffect(() => {
		const onVisible = () => {
			if (document.visibilityState === "visible") setNonce((n) => n + 1);
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => document.removeEventListener("visibilitychange", onVisible);
	}, []);
	useEffect(() => {
		let alive = true;
		fetch("/api/mcp-access", { cache: "no-store" })
			.then((r) => (r.ok ? r.json() : null))
			.then((body: { enabled?: unknown; agentConnected?: unknown; agentName?: unknown } | null) => {
				if (!alive || !body) return;
				setStatus({
					enabled: body.enabled === true,
					connected: body.agentConnected === true,
					name: typeof body.agentName === "string" ? body.agentName : undefined,
				});
			})
			.catch(() => {/* keep the last status */});
		return () => {
			alive = false;
		};
	}, [activityKey, nonce]);
	return status;
}

export function SidebarFooter() {
	const { feed } = useActivity();
	const jobs = feed.jobs.length + feed.extractions.length;
	const agent = useAgentStatus(feed);
	const { open: openSettings } = useSettingsDialog();
	const [open, setOpen] = useState(false);
	const anchorRef = useRef<HTMLButtonElement>(null);

	// The menu contract: a pointerdown outside closes it; Esc is claimed.
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as Node;
			if (target instanceof Element && target.closest("[data-lh-menu]")) return;
			if (anchorRef.current?.contains(target)) return;
			setOpen(false);
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				setOpen(false);
			}
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	return (
		<div className="flex w-full items-center justify-between gap-2 px-2.5 pt-2">
			<button
				ref={anchorRef}
				type="button"
				data-testid="sidebar-agent"
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
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
			<Hint label="Settings" action="open-settings" side="right">
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
			<MenuShell
				open={open}
				anchorRef={anchorRef}
				testid="activity-menu"
				preferredSide="up"
				align="left"
				menuClass="flex w-72 flex-col border border-tone-2 bg-panel text-xs shadow-xl"
			>
				<ActivitySection />
			</MenuShell>
		</div>
	);
}
