/**
 * Settings → Connection: outside agents (Claude Code, Codex, any MCP client)
 * connect to godspeed and act as its AI, always on and the only model.
 * "Your agent": the connection status and the button that opens it in the
 * godspeed folder (or the setup for another MCP app); "Access": the access
 * token.
 */

import { useCallback, useEffect, useState } from "react";
import { agentStatusLabel, teachStep, useAgentStatus } from "@/frontend/components/agent-status";
import { AgentLauncher } from "@/frontend/components/agent-folder/agent-launcher";
import { OldSetupWarning } from "@/frontend/components/agent-folder/old-setup";
import { CopyButton } from "@/frontend/components/copy-button";
import { ACCESS_ERROR, maskToken } from "@/frontend/components/mcp-access";
import { cn } from "@/frontend/lib/utils";
import { OUTLINE_BUTTON, SettingsGroup, SettingsRow } from "./controls.tsx";

interface AccessView {
	token: string;
	url: string;
	agentConnected: boolean;
	agentTeaching: boolean;
	agentName: string | null;
	pendingWork: number;
}

async function request(init?: RequestInit): Promise<AccessView> {
	const res = await fetch("/api/mcp-access", { cache: "no-store", ...init, headers: { "Content-Type": "application/json" } });
	if (!res.ok) throw new Error(ACCESS_ERROR);
	return res.json() as Promise<AccessView>;
}

const OPEN_BELOW = "Open your agent with the button below.";

export function ConnectionSection() {
	const [access, setAccess] = useState<AccessView | null>(null);
	const [error, setError] = useState<string | null>(null);
	// "New token" asks first, then says what to copy again. "making": Continue
	// is off until the new token arrives, so a double click makes one token.
	const [rotate, setRotate] = useState<"idle" | "asking" | "making" | "done">("idle");

	// Any success clears an earlier failure, so a stale error never sits under good data.
	const loaded = useCallback((a: AccessView) => {
		setAccess(a);
		setError(null);
	}, []);
	const refresh = useCallback(() => {
		request().then(loaded, (e: Error) => setError(e.message));
	}, [loaded]);
	// Re-read whenever the live agent status changes (agent-status.tsx).
	const live = useAgentStatus();
	useEffect(() => {
		refresh();
	}, [refresh, live]);

	const makeToken = () => {
		setRotate("making");
		request({ method: "POST", body: JSON.stringify({ action: "rotate" }) }).then(
			(a) => {
				loaded(a);
				setRotate("done");
			},
			(e: Error) => {
				setError(e.message);
				setRotate("idle");
			},
		);
	};

	if (!access) return <p className="text-xs text-ink-2">{error ?? "Loading…"}</p>;
	const token = access.token;
	const agent = { connected: access.agentConnected, teaching: access.agentTeaching, name: access.agentName ?? undefined, pendingWork: access.pendingWork };
	const hint = agent.teaching ? null : agent.connected ? teachStep(agent.name) : agent.pendingWork > 0 ? OPEN_BELOW : null;

	return (
		<>
			<SettingsGroup label="Your agent">
				<SettingsRow label="Status">
					<span className="flex min-w-0 items-start gap-2.5">
						<span aria-hidden className={cn("mt-[7px] size-3 shrink-0", agent.teaching ? "bg-ans-right" : agent.connected || agent.pendingWork > 0 ? "bg-highlight" : "bg-ink-3")} />
						<span className="min-w-0">
							<span data-testid="agent-status" className="block truncate text-[15px] font-medium text-ink">
								{agentStatusLabel(agent, 0)}
							</span>
							{hint && (
								<span data-testid="agent-teach-hint" className="block text-base text-ink-2">
									{hint}
								</span>
							)}
						</span>
					</span>
				</SettingsRow>
				<div className="flex flex-col gap-3 py-3">
					<OldSetupWarning />
					<AgentLauncher />
				</div>
			</SettingsGroup>

			<SettingsGroup label="Access">
				<SettingsRow label="Access token" hint="Anyone with this token can use godspeed as you. Make a new one if it leaks.">
					<span className="flex min-w-0 items-center gap-2">
						<span data-testid="agent-token" className="min-w-0 truncate text-[15px] text-ink">
							{maskToken(token)}
						</span>
						<CopyButton aria-label="Copy access token" className={OUTLINE_BUTTON} text={token} />
						<button type="button" data-testid="agent-new-token" className={OUTLINE_BUTTON} disabled={rotate === "asking" || rotate === "making"} onClick={() => setRotate("asking")}>
							New token
						</button>
					</span>
				</SettingsRow>
				{(rotate === "asking" || rotate === "making") && (
					<div data-testid="agent-new-token-confirm" className="flex items-center justify-between gap-4 py-3">
						<span className="text-[15px] text-ink">Other MCP apps will need the new token. Continue?</span>
						<span className="flex shrink-0 items-center gap-2">
							<button type="button" className={`lh-press ${OUTLINE_BUTTON}`} onClick={() => setRotate("idle")}>
								Cancel
							</button>
							<button
								type="button"
								data-testid="agent-new-token-continue"
								className={`${OUTLINE_BUTTON} lh-btn-main`}
								disabled={rotate === "making"}
								onClick={makeToken}
							>
								Continue
							</button>
						</span>
					</div>
				)}
				{rotate === "done" && (
					<p data-testid="agent-new-token-note" className="text-ink-2">
						New token made. Copy it into your other MCP apps again. Claude Code and Codex pick it up by themselves.
					</p>
				)}
				{error && <p className="text-ans-wrong">{error}</p>}
			</SettingsGroup>
		</>
	);
}

/** The section's head tooltip: what outside agents do, and how to use one. */
export const CONNECTION_SECTION_HINT =
	"Claude Code, Codex, or another MCP app is your teacher. It teaches your lessons and does the helper and graph work too. Open it with the button under Your agent.";
