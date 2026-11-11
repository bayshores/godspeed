"use client";

import { useAgentStatus } from "@/frontend/components/agent-status";
import { cn } from "@/frontend/lib/utils";
import { useReopenAgent } from "./use-agent-folder";

/**
 * Next to a control that needs the agent (Talk's Send, Start lesson,
 * Submit answer): "No agent connected" and the button that opens it, while
 * none is. Nothing otherwise.
 */
export function NoAgentLine({ className }: { className?: string }) {
	const agent = useAgentStatus();
	if (!agent || agent.connected || agent.teaching) return null;
	return <Line className={className} />;
}

function Line({ className }: { className?: string }) {
	const reopen = useReopenAgent();
	return (
		<div data-testid="no-agent" className={cn("lh-rise flex flex-col gap-1 text-[15px]", className)}>
			<p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-ink">
				<span aria-hidden className="size-2.5 shrink-0 bg-ink-3" />
				No agent connected
				<button type="button" data-testid="no-agent-open" disabled={reopen.busy} onClick={reopen.open} className="lh-btn h-[30px] px-2.5 text-[15px]">
					{reopen.label}
				</button>
			</p>
			{reopen.error && (
				<p role="alert" className="text-ans-wrong">
					{reopen.error}
				</p>
			)}
			{reopen.manual && <p className="text-ink-2">Run the command from Settings, Connection in your terminal.</p>}
		</div>
	);
}
