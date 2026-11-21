import { DEFAULT_TEACHER_NAME } from "@/shared/core";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { useWaited } from "@/frontend/components/loading";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { agentHereNow, useTerminals } from "@/frontend/components/terminal/use-terminals";
import { cn } from "@/frontend/lib/utils";
import { useStartAgent } from "./use-agent-folder";

/**
 * Next to a control that needs the agent (Start lesson, Submit answer):
 * "Teacher is off" and the button that turns it on, while no agent is
 * here. Nothing otherwise, and nothing while the open panel shows that
 * button itself.
 */
export function NoAgentLine({ className }: { className?: string }) {
	const panelStarts = useTeacher()?.panelStarts ?? false;
	const shown = agentHereNow(useAgentStatus(), useTerminals()) === false && !panelStarts;
	// Only a line that comes after its page opened rises in; one the page opened with is just there.
	const arrives = useWaited(shown);
	if (!shown) return null;
	return <Line arrives={arrives} className={className} />;
}

function Line({ arrives, className }: { arrives: boolean; className?: string }) {
	const agent = useStartAgent();
	const name = useTeacher()?.name ?? DEFAULT_TEACHER_NAME;
	if (agent.starting) return null;
	return (
		<div data-testid="no-agent" className={cn("flex flex-col gap-1 text-[15px]", arrives && "lh-rise", className)}>
			<p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-ink">
				<span aria-hidden className="size-2.5 shrink-0 bg-ink-3" />
				{name} is off
				<button type="button" data-testid="no-agent-open" disabled={agent.busy} onClick={agent.start} className="lh-btn lh-btn-small">
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
