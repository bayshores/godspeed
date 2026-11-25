import { useAgentStatus } from "@/frontend/components/agent-status";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { agentHereNow, noAgentHere, useTerminals } from "@/frontend/components/terminal/use-terminals";

/** Whether the teacher is off: no agent is here and godspeed is not starting one by itself.
 *  Null until godspeed has read whether one is here. */
export function useTeacherOff(): boolean | null {
	const status = useAgentStatus();
	const terminals = useTerminals();
	if (agentHereNow(status, terminals) === null) return null;
	return noAgentHere(status, terminals) && !terminals?.waking;
}

/** Whether the key that turns the teacher on may show: the teacher is off and its panel does
 *  not show its own. */
export function useStartKey(): boolean {
	const off = useTeacherOff() === true;
	const panelStarts = useTeacher()?.panelStarts ?? false;
	return off && !panelStarts;
}
