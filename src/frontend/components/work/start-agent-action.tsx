import { useStartAgent } from "@/frontend/components/agent-folder/use-agent-folder";

/** The work frame's button while no agent takes the work: turns the
 *  teacher on, starting the agent last started here. */
export function StartAgentAction() {
	const agent = useStartAgent();
	if (agent.starting) return null;
	return (
		<>
			<button type="button" data-testid="work-frame-open" disabled={agent.busy} onClick={agent.start} className="lh-btn lh-btn-main lh-btn-small shrink-0">
				{agent.label}
			</button>
			{agent.error && (
				<span role="alert" title={agent.error} className="min-w-0 truncate text-[15px] text-ans-wrong">
					{agent.error}
				</span>
			)}
		</>
	);
}
