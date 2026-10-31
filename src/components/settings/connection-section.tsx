/**
 * Settings → Connection: outside agents (Claude Code, Codex, any MCP client)
 * connect to godspeed and act as its AI, always on and the only model.
 * "Access": the connection status and the access token; "Your agent":
 * the button that opens it in the godspeed folder (or the setup for
 * another MCP app).
 */

import { useCallback, useEffect, useState } from "react";
import { footerLabel, teachStep, useAgentStatus } from "@/components/agent-status";
import { AgentLauncher } from "@/components/agent-folder/agent-launcher";
import { CopyButton } from "@/components/copy-button";
import { ACCESS_ERROR, maskToken } from "@/components/mcp-access";
import { cn } from "@/lib/utils";
import { OUTLINE_BUTTON, SettingsGroup, SettingsRow } from "./controls.tsx";
import { RememberedNotes } from "./remembered-notes.tsx";

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

const MONO = "min-w-0 truncate font-mono text-[12.5px] text-ink-2";

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

	return (
		<>
			<SettingsGroup label="Access">
				<SettingsRow
					label="Connection"
					tip="Claude Code, Codex, or another MCP app on this computer teaches you and can read your lessons and graph."
					hint={!agent.teaching && (agent.connected || agent.pendingWork > 0) ? <span data-testid="agent-teach-hint">{teachStep(agent.name)}</span> : undefined}
				>
					<span data-testid="agent-status" className="flex min-w-0 items-center gap-2 text-[13.5px] text-ink-2">
						<span aria-hidden className={cn("size-[7px] shrink-0 rounded-full", access.agentConnected ? "bg-ans-right" : "bg-ink-3")} />
						<span className="truncate">{footerLabel(agent, access.pendingWork)}</span>
					</span>
				</SettingsRow>
				<SettingsRow label="Access token" tip="Anyone with this token can use godspeed as you. Make a new one if it leaks.">
					<span className="flex min-w-0 items-center gap-2">
						<span data-testid="agent-token" className={MONO}>
							{maskToken(token)}
						</span>
						<CopyButton aria-label="Copy access token" className={OUTLINE_BUTTON} text={token} />
						<button type="button" data-testid="agent-new-token" className={OUTLINE_BUTTON} disabled={rotate === "asking" || rotate === "making"} onClick={() => setRotate("asking")}>
							New token
						</button>
					</span>
				</SettingsRow>
				{(rotate === "asking" || rotate === "making") && (
					<div data-testid="agent-new-token-confirm" className="flex items-center justify-between gap-4 bg-tone px-3.5 py-2.5">
						<span className="text-[13px] text-ink-2">Other MCP apps will need the new token. Continue?</span>
						<span className="flex shrink-0 items-center gap-2">
							<button type="button" className="lh-press px-2.5 py-[5px] text-[13px] font-bold text-ink-2 hover:text-ink" onClick={() => setRotate("idle")}>
								Cancel
							</button>
							<button
								type="button"
								data-testid="agent-new-token-continue"
								className={OUTLINE_BUTTON}
								disabled={rotate === "making"}
								onClick={makeToken}
							>
								Continue
							</button>
						</span>
					</div>
				)}
				{rotate === "done" && (
					<p data-testid="agent-new-token-note" className="text-xs text-ink-2">
						New token made. Copy it into your other MCP apps again. Claude Code and Codex pick it up by themselves.
					</p>
				)}
				{error && <p className="text-xs text-ans-wrong">{error}</p>}
			</SettingsGroup>

			<SettingsGroup label="Your agent">
				<div className="py-3">
					<AgentLauncher />
				</div>
			</SettingsGroup>

			<RememberedNotes />
		</>
	);
}

/** The section's head tooltip: what outside agents do, and how to use one. */
export const CONNECTION_SECTION_HINT =
	"Claude Code, Codex, or another MCP app is your teacher. It teaches your lessons and does the helper and graph work too. Open it with the button under Your agent.";
