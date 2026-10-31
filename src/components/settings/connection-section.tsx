/**
 * Settings → Connection: outside agents (Claude Code, Codex, any MCP client)
 * connect to godspeed and act as its AI, always on and the only model.
 * "Access": the connection status and the access token; "Setup":
 * copy-ready setup for each agent, with its steps written under its name.
 */

import { useCallback, useEffect, useState } from "react";
import { footerLabel, teachStep, useAgentStatus } from "@/components/agent-status";
import { CopyButton } from "@/components/copy-button";
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

/** Shown when the access settings can't be read. */
export const ACCESS_ERROR = "Agent access settings are unavailable. Restart godspeed and try again.";

async function request(init?: RequestInit): Promise<AccessView> {
	const res = await fetch("/api/mcp-access", { cache: "no-store", ...init, headers: { "Content-Type": "application/json" } });
	if (!res.ok) throw new Error(ACCESS_ERROR);
	return res.json() as Promise<AccessView>;
}

/** The commands Claude Code runs, one at a time. */
export const CLAUDE_CODE_SETUP = "/plugin marketplace add bayshores/godspeed\n/plugin install godspeed@godspeed";

/** The token as dots and its last four characters. */
export function maskToken(token: string): string {
	return token.length <= 4 ? token : `${"•".repeat(12)}${token.slice(-4)}`;
}

/** The Codex config block for this app's address and token. */
export function codexConfig(url: string, token: string): string {
	return `[mcp_servers.godspeed]\nurl = "${url}"\nhttp_headers = { "Authorization" = "Bearer ${token}" }\ntool_timeout_sec = 600`;
}

/** "127.0.0.1:47613/api/mcp" — the address without its scheme. */
function shortUrl(url: string): string {
	return url.replace(/^https?:\/\//, "");
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
						<span className="text-[13px] text-ink-2">Codex and other apps will need the new config. Continue?</span>
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
						New token made. Copy the Codex config or the MCP setup below again and paste it into your app. Claude Code picks up the new
						token by itself.
					</p>
				)}
				{error && <p className="text-xs text-ans-wrong">{error}</p>}
			</SettingsGroup>

			<SettingsGroup label="Setup">
				<SettingsRow
					label="Claude Code"
					hint={
						<>
							In Claude Code, run these one at a time (Copy copies both). The plugin finds this app and its token by itself. Then start
							teaching with <span className="font-mono">/godspeed:teach</span> (add a topic to start a new lesson). Put Claude Code in auto mode
							first, so it never stops to ask your permission.
						</>
					}
				>
					<span className="flex min-w-0 items-center gap-2">
						<span className={MONO}>/plugin install godspeed@godspeed</span>
						<CopyButton aria-label="Copy Claude Code setup" className={OUTLINE_BUTTON} text={CLAUDE_CODE_SETUP} />
					</span>
				</SettingsRow>
				<SettingsRow label="Codex" hint="Add this to ~/.codex/config.toml, then ask Codex to use the godspeed tools to teach you. Set Codex's approvals to Full Access first, so it never stops to ask your permission.">
					<CopyButton aria-label="Copy Codex config" className={OUTLINE_BUTTON} text={codexConfig(access.url, token)}>
						Copy config
					</CopyButton>
				</SettingsRow>
				<SettingsRow
					label="Other MCP apps"
					hint={
						<>
							Use a Streamable HTTP server with this address and the header{" "}
							<span className="font-mono">Authorization: Bearer &lt;access token&gt;</span>. Let your agent use
							the godspeed tools without asking your permission.
						</>
					}
				>
					<span className="flex min-w-0 items-center gap-2">
						<span className={MONO}>{shortUrl(access.url)}</span>
						<CopyButton aria-label="Copy MCP address" className={OUTLINE_BUTTON} text={access.url} />
					</span>
				</SettingsRow>
			</SettingsGroup>

			<RememberedNotes />
		</>
	);
}

/** The section's head tooltip: what outside agents do, and how to use one. */
export const CONNECTION_SECTION_HINT =
	"Claude Code, Codex, or another MCP app is your teacher. It teaches your lessons and does the helper and graph work too. In Claude Code, run /godspeed:teach to start.";
