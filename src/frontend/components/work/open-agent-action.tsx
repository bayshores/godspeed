import { useReopenAgent } from "@/frontend/components/agent-folder/use-agent-folder";

/** The work frame's button while no agent takes the work: opens the agent
 *  last opened here. */
export function OpenAgentAction() {
	const reopen = useReopenAgent();
	return (
		<>
			<button type="button" data-testid="work-frame-open" aria-label={reopen.label} title={reopen.label} disabled={reopen.busy} onClick={reopen.open} className="lh-btn lh-btn-main h-7 shrink-0 px-2.5">
				Open
			</button>
			{reopen.error && (
				<span role="alert" title={reopen.error} className="min-w-0 truncate text-[15px] text-ans-wrong">
					{reopen.error}
				</span>
			)}
		</>
	);
}
