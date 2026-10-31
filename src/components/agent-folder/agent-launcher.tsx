import { useEffect, useState, type ReactNode } from "react";
import { CheckIcon } from "lucide-react";
import { useAgentStatus } from "@/components/agent-status";
import { CopyButton } from "@/components/copy-button";
import { ACCESS_ERROR, maskToken } from "@/components/mcp-access";
import { cn } from "@/lib/utils";
import { logLines, rememberedAgent, type LaunchChoice, type LogLine } from "./agent-folder-model";
import { OpenAgentButton } from "./open-agent-button";
import { savedAgent, useAgentFolder } from "./use-agent-folder";

const QUIET = "lh-press text-[13px] font-bold text-ink-3 hover:text-ink";

/**
 * Start your agent in the godspeed folder: the "Open Claude Code" split
 * button, a live log of each step (folder made, terminal opened, agent
 * started, teaching), and quiet links to change the folder or copy the
 * command. "Other app" shows the address and token for any MCP app.
 * Onboarding (step 1) and Settings → Connection use it; `extra` adds a
 * link at the end (onboarding's "I'll do this later").
 */
export function AgentLauncher({ extra, center = false }: { extra?: ReactNode; center?: boolean }) {
	const { view, launch, open, change } = useAgentFolder();
	const status = useAgentStatus();
	const [choice, setChoice] = useState<LaunchChoice>("claude");
	const [error, setError] = useState<string | null>(null);
	useEffect(() => setChoice(rememberedAgent(savedAgent())), []);

	const agent = choice === "other" ? null : choice;
	const lines = launch && view ? logLines(launch, { connected: !!status?.connected, teaching: !!status?.teaching }, view.short, window.lh?.platform === "darwin") : [];
	const busy = !!launch && (launch.made === "wait" || launch.opened === "wait");
	const canChange = typeof window !== "undefined" && !!window.lh?.pickFolder;

	return (
		<div className={cn("flex flex-col gap-6", center ? "items-center" : "items-start")}>
			<OpenAgentButton
				choice={choice}
				onChoose={(c) => {
					setChoice(c);
					setError(null);
				}}
				onOpen={() => agent && void open(agent)}
				busy={busy}
			/>
			{choice === "other" ? <OtherAppSetup /> : lines.length > 0 && <Log lines={lines} />}
			{error && (
				<p role="alert" className="text-[13px] text-ans-wrong">
					{error}
				</p>
			)}
			<div className={cn("flex flex-wrap items-center gap-x-5 gap-y-2", center && "justify-center")}>
				{view && agent && (
					<span className="text-[13px] text-ink-3" data-testid="agent-folder-path">
						Folder: <span className="font-mono text-[12.5px]">{view.short}</span>
					</span>
				)}
				{canChange && agent && (
					<button type="button" data-testid="agent-folder-change" className={QUIET} onClick={() => void change().then(setError)}>
						Change folder
					</button>
				)}
				{view && agent && (
					<CopyButton aria-label="Copy the command" className={QUIET} text={view.commands[agent]}>
						Copy the command
					</CopyButton>
				)}
				{extra}
			</div>
		</div>
	);
}

function Log({ lines }: { lines: LogLine[] }) {
	return (
		<div data-testid="agent-launch-log" aria-live="polite" className="flex w-full max-w-[560px] flex-col gap-2.5 border border-tone-2 bg-panel px-5 py-4 text-left font-mono text-[13px]">
			{lines.map((line) => (
				<div key={line.text} data-state={line.state} className="flex items-start gap-3">
					<span aria-hidden className="flex h-[19px] w-3.5 shrink-0 items-center justify-center">
						{line.state === "done" ? (
							<CheckIcon className="size-3.5 text-ans-right" />
						) : line.state === "wait" ? (
							<span className="ob-pulse size-2 rounded-full bg-ink-2" />
						) : null}
					</span>
					<span className={cn(line.state === "done" ? "text-ink-2" : line.state === "error" ? "text-ans-wrong" : line.state === "note" ? "font-sans text-ink-3" : "text-ink")}>
						{line.text}
					</span>
				</div>
			))}
		</div>
	);
}

/** Any other MCP app: the address and the access token to paste into it. */
function OtherAppSetup() {
	const [access, setAccess] = useState<{ url: string; token: string } | null>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		fetch("/api/mcp-access", { cache: "no-store" })
			.then((r) => (r.ok ? (r.json() as Promise<{ url: string; token: string }>) : Promise.reject()))
			.then((a) => setAccess({ url: a.url, token: a.token }), () => setFailed(true));
	}, []);
	if (!access) return <p className="text-[13px] text-ink-2">{failed ? ACCESS_ERROR : "Loading…"}</p>;
	return (
		<div className="flex w-full max-w-[560px] flex-col gap-3 text-left">
			<p className="text-[14px] text-ink-2">
				Add a Streamable HTTP MCP server with this address and header, then ask your app to teach you with the godspeed tools. Let it use
				them without asking your permission.
			</p>
			<div className="border border-tone-2 bg-panel">
				<div className="flex items-center justify-between border-b border-tone-2 px-4 py-2.5">
					<span className="text-[12.5px] text-ink-3">MCP server</span>
					<CopyButton
						text={`${access.url}\nAuthorization: Bearer ${access.token}`}
						icon
						aria-label="Copy MCP server"
						className="lh-press flex items-center gap-1.5 text-[12.5px] font-bold text-ink-2 hover:text-ink"
					/>
				</div>
				<pre className="overflow-x-auto px-4 py-3.5 font-mono text-[13px] leading-[1.9] text-ink">
					{access.url}
					{"\n"}Authorization: Bearer {maskToken(access.token)}
				</pre>
			</div>
		</div>
	);
}
