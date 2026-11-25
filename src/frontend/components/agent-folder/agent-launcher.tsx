import { LoadingLine } from "@/frontend/components/loading";
import { useMcpAccess } from "@/frontend/components/agent-status";
import { CopyButton } from "@/frontend/components/copy-button";
import { ACCESS_ERROR, maskToken } from "@/frontend/components/mcp-access";
import { QUIET_KEY } from "@/frontend/components/settings/controls";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import type { LogLine } from "./agent-folder-model";

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
	const { access, failed } = useMcpAccess();
	if (!access) return failed ? <p className="text-[15px] text-ink-2">{ACCESS_ERROR}</p> : <LoadingLine className="text-[15px]" />;
	return (
		<div className="flex w-full flex-col gap-3 text-left">
			<p className="text-[15px] text-ink-2">
				Add a Streamable HTTP MCP server with this address and header, then ask your app to teach you with the godspeed tools. Let it use
				them without asking your permission.
			</p>
			<div className="lh-well rounded">
				<div className="flex items-center justify-between px-4 py-2.5">
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
