import { useStartAgent } from "@/frontend/components/agent-folder/use-agent-folder";

/** In the Talk thread while no agent is connected: the teacher says so and
 *  the button starts one. */
export function TalkNoAgent() {
	const agent = useStartAgent();
	return (
		<div data-testid="no-agent" className="lh-rise flex flex-col items-start gap-3.5">
			<p className="font-prose text-lg leading-6 text-ink">I&apos;m not connected yet. {agent.label} and I&apos;ll begin.</p>
			<button type="button" data-testid="no-agent-open" disabled={agent.busy} onClick={agent.start} className="lh-btn lh-btn-main text-[15px]">
				{agent.label}
			</button>
			{agent.error && (
				<p role="alert" className="text-[15px] text-ans-wrong">
					{agent.error}
				</p>
			)}
			<p className="text-[15px] text-ink-2">If that does not work, run the command from Settings, Connection in your terminal.</p>
		</div>
	);
}
