"use client";
/**
 * Settings → Outside agents: let outside agents (Claude Code, Codex, any MCP
 * client) connect to godspeed and act as its AI. One switch, the
 * connection details, and copy-ready setup for each agent.
 */

import { useCallback, useEffect, useState } from "react";
import { SettingsGroup, SettingsRow, Toggle } from "./controls.tsx";

interface AccessView {
	enabled: boolean;
	token: string | null;
	url: string;
	agentConnected: boolean;
	pendingWork: number;
}

async function request(init?: RequestInit): Promise<AccessView> {
	const res = await fetch("/api/mcp-access", { cache: "no-store", ...init, headers: { "Content-Type": "application/json" } });
	if (!res.ok) throw new Error("Agent access settings are unavailable.");
	return res.json() as Promise<AccessView>;
}

function CopyBlock({ text, label }: { text: string; label: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<div className="relative">
			<pre className="overflow-x-auto whitespace-pre-wrap break-all rounded border border-border bg-muted/40 p-2 pr-14 font-mono text-xs">{text}</pre>
			<button
				type="button"
				aria-label={`Copy ${label}`}
				className="lh-press absolute right-1.5 top-1.5 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
				onClick={() => {
					void navigator.clipboard.writeText(text).then(() => {
						setCopied(true);
						setTimeout(() => setCopied(false), 1500);
					});
				}}
			>
				{copied ? "Copied" : "Copy"}
			</button>
		</div>
	);
}

export function AgentsSection() {
	const [access, setAccess] = useState<AccessView | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [showToken, setShowToken] = useState(false);

	const refresh = useCallback(() => {
		request().then(setAccess, (e: Error) => setError(e.message));
	}, []);
	useEffect(() => {
		refresh();
		const timer = setInterval(refresh, 5000); // connection status
		return () => clearInterval(timer);
	}, [refresh]);

	const act = (action: "enable" | "rotate" | "disable") =>
		request({ method: "POST", body: JSON.stringify({ action }) }).then(setAccess, (e: Error) => setError(e.message));

	if (!access) return <p className="text-xs text-muted-foreground">{error ?? "Loading…"}</p>;
	const token = access.token ?? "";
	const codex = `[mcp_servers.godspeed]\nurl = "${access.url}"\nhttp_headers = { "Authorization" = "Bearer ${token}" }\ntool_timeout_sec = 120`;

	return (
		<>
			<SettingsGroup label="Access">
				<SettingsRow
					label="Let outside agents connect"
					hint="Claude Code, Codex, or another MCP app on this computer can teach you and read your lessons and graph."
				>
					<Toggle label="Outside agent access" checked={access.enabled} onChange={(on) => void act(on ? "enable" : "disable")} />
				</SettingsRow>
				{access.enabled && (
					<SettingsRow
						label="Status"
						hint={access.pendingWork > 0 ? `${access.pendingWork} request(s) waiting for the agent` : undefined}
					>
						<span data-testid="agent-status" className="text-xs text-muted-foreground">
							{access.agentConnected ? "Agent connected" : "No agent connected"}
						</span>
					</SettingsRow>
				)}
				{error && <p className="text-xs text-destructive">{error}</p>}
			</SettingsGroup>

			{access.enabled && (
				<>
					<SettingsGroup label="Connection">
						<SettingsRow label="Address">
							<span className="font-mono text-xs">{access.url}</span>
						</SettingsRow>
						<SettingsRow label="Access token" hint="Anyone with this token can use godspeed as you. Make a new one if it leaks.">
							<span className="flex items-center gap-2">
								<button type="button" className="lh-press text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowToken((s) => !s)}>
									{showToken ? "Hide" : "Show"}
								</button>
								<button type="button" className="lh-press text-xs text-muted-foreground hover:text-foreground" onClick={() => void act("rotate")}>
									New token
								</button>
							</span>
						</SettingsRow>
						{showToken && <CopyBlock label="access token" text={token} />}
					</SettingsGroup>

					<SettingsGroup label="Set up Claude Code">
						<p className="text-xs text-muted-foreground">In Claude Code, run these one at a time. The plugin finds this app and its token by itself.</p>
						<CopyBlock label="Claude Code setup" text={"/plugin marketplace add bayshores/godspeed\n/plugin install godspeed@godspeed"} />
						<p className="text-xs text-muted-foreground">Then start teaching with <span className="font-mono">/godspeed:teach</span> (add a topic to start a new lesson).</p>
					</SettingsGroup>

					<SettingsGroup label="Set up Codex">
						<p className="text-xs text-muted-foreground">Add this to ~/.codex/config.toml, then ask Codex to use the godspeed tools to teach you.</p>
						<CopyBlock label="Codex config" text={codex} />
					</SettingsGroup>

					<SettingsGroup label="Other MCP apps">
						<p className="text-xs text-muted-foreground">Use a Streamable HTTP server with this address and the header <span className="font-mono">Authorization: Bearer &lt;access token&gt;</span>.</p>
					</SettingsGroup>

					<SettingsGroup label="Using it">
						<p className="text-xs text-muted-foreground">
							Pick <span className="font-mono">Outside agent (MCP)</span> as a lesson&apos;s model to have the agent teach it. Pick it for the helper or graph models in the Agent section to have the agent do that work too.
						</p>
					</SettingsGroup>
				</>
			)}
		</>
	);
}
