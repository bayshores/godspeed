import { useAgentStatus } from "@/frontend/components/agent-status";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { noAgentHere, useTerminals } from "@/frontend/components/terminal/use-terminals";
import { StartAgentAction } from "@/frontend/components/work/start-agent-action";

/** While the turn waits for an agent: the key that turns the teacher on, when none is here and
 *  godspeed is not starting one by itself, and the teacher's panel does not show its own. */
export function StartKey() {
	const status = useAgentStatus();
	const terminals = useTerminals();
	const panelStarts = useTeacher()?.panelStarts ?? false;
	if (!noAgentHere(status, terminals) || terminals?.waking || panelStarts) return null;
	return <StartAgentAction />;
}
