import { useReopenAgent } from "@/frontend/components/agent-folder/use-agent-folder";

/** In the Talk thread while no agent is connected: the teacher says so and
 *  the button opens one. */
export function TalkNoAgent() {
	const reopen = useReopenAgent();
	return (
		<div data-testid="no-agent" className="lh-rise flex flex-col items-start gap-3.5">
			<p className="font-prose text-lg leading-6 text-ink">I&apos;m not connected yet. {reopen.label} and I&apos;ll start.</p>
			<button type="button" data-testid="no-agent-open" disabled={reopen.busy} onClick={reopen.open} className="lh-btn lh-btn-main text-[15px]">
				{reopen.label}
			</button>
			{reopen.error && (
				<p role="alert" className="text-[15px] text-ans-wrong">
					{reopen.error}
				</p>
			)}
			<p className="text-[15px] text-ink-2">If that does not work, run the command from Settings, Connection in your terminal.</p>
		</div>
	);
}
