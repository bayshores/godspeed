import { useStartAgent } from "@/frontend/components/agent-folder/use-agent-folder";

/** The work frame's button while no agent takes the work: starts the agent
 *  last started here. */
export function StartAgentAction() {
	const agent = useStartAgent();
	return (
		<>
			<button type="button" data-testid="work-frame-open" aria-label={agent.label} title={agent.label} disabled={agent.busy} onClick={agent.start} className="lh-btn lh-btn-main h-7 shrink-0 px-2.5">
				Start
			</button>
			{agent.error && (
				<span role="alert" title={agent.error} className="min-w-0 truncate text-[15px] text-ans-wrong">
					{agent.error}
				</span>
			)}
		</>
	);
}
