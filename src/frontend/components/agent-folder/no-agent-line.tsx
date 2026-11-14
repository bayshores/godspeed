import { useAgentStatus } from "@/frontend/components/agent-status";
import { cn } from "@/frontend/lib/utils";
import { useStartAgent } from "./use-agent-folder";

/**
 * Next to a control that needs the agent (Talk's Send, Start lesson,
 * Submit answer): "No agent connected" and the button that starts it, while
 * none is. Nothing otherwise.
 */
export function NoAgentLine({ className }: { className?: string }) {
	const agent = useAgentStatus();
	if (!agent || agent.connected || agent.teaching) return null;
	return <Line className={className} />;
}

function Line({ className }: { className?: string }) {
	const agent = useStartAgent();
	if (agent.starting) return null;
	return (
		<div data-testid="no-agent" className={cn("lh-rise flex flex-col gap-1 text-[15px]", className)}>
			<p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-ink">
				<span aria-hidden className="size-2.5 shrink-0 bg-ink-3" />
				No agent connected
				<button type="button" data-testid="no-agent-open" disabled={agent.busy} onClick={agent.start} className="lh-btn h-[30px] px-2.5 text-[15px]">
					{agent.label}
				</button>
			</p>
			{agent.error && (
				<p role="alert" className="text-ans-wrong">
					{agent.error}
				</p>
			)}
			{agent.manual && <p className="text-ink-2">Run the command from Settings, Connection in your terminal.</p>}
		</div>
	);
}
