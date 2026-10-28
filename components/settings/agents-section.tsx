/**
 * Settings → Outside agents (restyled 2026-10-27 — design/exports/
 * settings.html): outside agents (Claude Code, Codex, any MCP client)
 * connect to godspeed and act as its AI — always on, the only model
 * (owner, 2026-10-27). "Access": the connection status and the access
 * token; "Setup": copy-ready setup for each agent. Explanations live in
 * the labels' hover tooltips.
 */

import { useCallback, useEffect, useState } from "react";
import { footerLabel, useAgentStatus } from "@/components/agent-status";
import { cn } from "@/lib/utils";
import { OUTLINE_BUTTON, SettingsGroup, SettingsRow } from "./controls.tsx";

interface AccessView {
	token: string;
	url: string;
	agentConnected: boolean;
	agentName: string | null;
	pendingWork: number;
}

async function request(init?: RequestInit): Promise<AccessView> {
	const res = await fetch("/api/mcp-access", { cache: "no-store", ...init, headers: { "Content-Type": "application/json" } });
	if (!res.ok) throw new Error("Agent access settings are unavailable.");
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
	return `[mcp_servers.godspeed]\nurl = "${url}"\nhttp_headers = { "Authorization" = "Bearer ${token}" }\ntool_timeout_sec = 120`;
}

/** "127.0.0.1:47613/api/mcp" — the address without its scheme. */
function shortUrl(url: string): string {
	return url.replace(/^https?:\/\//, "");
}

function CopyButton({ text, label, children = "Copy" }: { text: string; label: string; children?: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			aria-label={`Copy ${label}`}
			className={OUTLINE_BUTTON}
			onClick={() => {
				void navigator.clipboard.writeText(text).then(() => {
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				});
			}}
		>
			{copied ? "Copied" : children}
		</button>
	);
}

const MONO = "min-w-0 truncate font-mono text-[12.5px] text-ink-2";

export function AgentsSection() {
	const [access, setAccess] = useState<AccessView | null>(null);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(() => {
		request().then(setAccess, (e: Error) => setError(e.message));
	}, []);
	// Re-read whenever the live agent status changes (agent-status.tsx).
	const live = useAgentStatus();
	useEffect(() => {
		refresh();
	}, [refresh, live]);

	const rotate = () =>
		request({ method: "POST", body: JSON.stringify({ action: "rotate" }) }).then(setAccess, (e: Error) => setError(e.message));

	if (!access) return <p className="text-xs text-ink-3">{error ?? "Loading…"}</p>;
	const token = access.token;

	return (
		<>
			<SettingsGroup label="Access">
				<SettingsRow
					label="Connection"
					tip="Claude Code, Codex, or another MCP app on this computer teaches you and can read your lessons and graph."
				>
					<span data-testid="agent-status" className="flex min-w-0 items-center gap-2 text-[13.5px] text-ink-2">
						<span aria-hidden className={cn("size-[7px] shrink-0 rounded-full", access.agentConnected ? "bg-ans-right" : "bg-ink-3")} />
						<span className="truncate">{footerLabel({ connected: access.agentConnected, name: access.agentName ?? undefined, pendingWork: access.pendingWork }, access.pendingWork)}</span>
					</span>
				</SettingsRow>
				<SettingsRow label="Access token" tip="Anyone with this token can use godspeed as you. Make a new one if it leaks.">
					<span className="flex min-w-0 items-center gap-2">
						<span data-testid="agent-token" className={MONO}>
							{maskToken(token)}
						</span>
						<CopyButton label="access token" text={token} />
						<button type="button" className={OUTLINE_BUTTON} onClick={() => void rotate()}>
							New token
						</button>
					</span>
				</SettingsRow>
				{error && <p className="text-xs text-ans-wrong">{error}</p>}
			</SettingsGroup>

			<SettingsGroup label="Setup">
				<SettingsRow
					label="Claude Code"
					tip={
						<>
							In Claude Code, run these one at a time (Copy copies both). The plugin finds this app and its token by itself. Then start
							teaching with <span className="font-mono">/godspeed:teach</span> (add a topic to start a new lesson).
						</>
					}
				>
					<span className="flex min-w-0 items-center gap-2">
						<span className={MONO}>/plugin install godspeed@godspeed</span>
						<CopyButton label="Claude Code setup" text={CLAUDE_CODE_SETUP} />
					</span>
				</SettingsRow>
				<SettingsRow label="Codex" tip="Add this to ~/.codex/config.toml, then ask Codex to use the godspeed tools to teach you.">
					<CopyButton label="Codex config" text={codexConfig(access.url, token)}>
						Copy config
					</CopyButton>
				</SettingsRow>
				<SettingsRow
					label="Other MCP apps"
					tip={
						<>
							Use a Streamable HTTP server with this address and the header{" "}
							<span className="font-mono">Authorization: Bearer &lt;access token&gt;</span>.
						</>
					}
				>
					<span className="flex min-w-0 items-center gap-2">
						<span className={MONO}>{shortUrl(access.url)}</span>
						<CopyButton label="MCP address" text={access.url} />
					</span>
				</SettingsRow>
			</SettingsGroup>
		</>
	);
}

/** The section's head tooltip: what outside agents do, and how to use one. */
export const AGENTS_SECTION_HINT =
	"Claude Code, Codex, or another MCP app is your teacher. It teaches your lessons and does the helper and graph work too. In Claude Code, run /godspeed:teach to start.";
