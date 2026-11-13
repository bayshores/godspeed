import { useEffect, useState } from "react";
import { CopyButton } from "@/frontend/components/copy-button";
import { ACCESS_ERROR, maskToken } from "@/frontend/components/mcp-access";
import { QUIET_KEY } from "@/frontend/components/settings/controls";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { rememberedAgent, type LaunchChoice, type LogLine } from "./agent-folder-model";
import { FolderLine } from "./folder-line";
import { OpenAgentButton } from "./open-agent-button";
import { savedAgent, useAgentFolder } from "./use-agent-folder";

/**
 * Start your agent in the godspeed folder: "Open Claude Code" and "Use
 * another agent", a live log of each step (folder made, terminal opened,
 * agent started, teaching), and under a dotted rule the folder with quiet
 * buttons to change it, copy the command or change the command that
 * starts the agent. "Other app" shows the address and token for any MCP
 * app. Onboarding (step 1) uses it.
 */
export function AgentLauncher() {
	const { view, lines, busy, open, change, setStartCommand } = useAgentFolder();
	const [choice, setChoice] = useState<LaunchChoice>("claude");
	const [error, setError] = useState<string | null>(null);
	useEffect(() => setChoice(rememberedAgent(savedAgent())), []);

	const agent = choice === "other" ? null : choice;

	return (
		<div className="flex w-full flex-col items-start gap-4">
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
				<p role="alert" className="text-[15px] text-ans-wrong">
					{error}
				</p>
			)}
			{agent && (
				// The line is drawn only when there is a folder to show or change.
				<div className="flex w-full flex-col gap-4 border-t-2 border-dotted border-ink-3 pt-4 empty:hidden">
					<FolderLine key={agent} agent={agent} view={view} change={change} setStartCommand={setStartCommand} onError={setError}>
						Folder: {view?.short}
					</FolderLine>
				</div>
			)}
		</div>
	);
}

/** The launch steps: a green square with a tick when done, a half-filled square while running. */
export function Log({ lines }: { lines: LogLine[] }) {
	return (
		<div data-testid="agent-launch-log" aria-live="polite" className="flex w-full flex-col py-1.5 text-left text-[15px]">
			{lines.map((line) => (
				<div key={line.text} data-state={line.state} className={cn("flex items-center gap-2.5", line.state === "note" ? "pt-1 text-sm text-ink-2" : "py-[3px]")}>
					{line.state !== "note" && (
						<span aria-hidden className={cn("flex size-4 shrink-0 items-center justify-center", line.state === "done" && "bg-ans-right text-ink")}>
							{line.state === "done" ? (
								<PixelIcon name="check" className="h-[7px]" />
							) : line.state === "wait" ? (
								<span className="relative size-4 border-2 border-ink">
									<span className="ob-pulse absolute inset-y-0 left-0 w-1/2 bg-ink" />
								</span>
							) : null}
						</span>
					)}
					<span className={cn(line.state === "error" ? "text-ans-wrong" : line.state === "note" ? "" : "text-ink")}>{line.text}</span>
				</div>
			))}
		</div>
	);
}

/** Any other MCP app: the address and the access token to paste into it. */
export function OtherAppSetup() {
	const [access, setAccess] = useState<{ url: string; token: string } | null>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		fetch("/api/mcp-access", { cache: "no-store" })
			.then((r) => (r.ok ? (r.json() as Promise<{ url: string; token: string }>) : Promise.reject()))
			.then((a) => setAccess({ url: a.url, token: a.token }), () => setFailed(true));
	}, []);
	if (!access) return <p className="text-[15px] text-ink-2">{failed ? ACCESS_ERROR : "Loading…"}</p>;
	return (
		<div className="flex w-full flex-col gap-3 text-left">
			<p className="text-[15px] text-ink-2">
				Add a Streamable HTTP MCP server with this address and header, then ask your app to teach you with the godspeed tools. Let it use
				them without asking your permission. For a helper, start a second session and tell it "Start as the helper".
			</p>
			<div className="rounded border-[1.5px] border-ink bg-background">
				<div className="flex items-center justify-between border-b border-line px-4 py-2.5">
					<span className="text-[15px] text-ink-2">MCP server</span>
					<CopyButton
						text={`${access.url}\nAuthorization: Bearer ${access.token}`}
						aria-label="Copy MCP server"
						className={QUIET_KEY}
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
