/**
 * Settings → Connection, "Your agent": what the teacher's tile says. Pure.
 */
import type { AgentDoing } from "@/frontend/components/teacher/follow-status";

export interface AgentTile {
	chip: string;
	line: string;
	note: string;
}

/** `outside`: the agent here was started outside godspeed. The teacher
 *  starts from its own window, so its tile has no button. */
export function teacherTile(doing: AgentDoing | null, outside: boolean): AgentTile {
	const note = outside ? "Connected from outside godspeed." : "Teaches and answers you";
	// "Teaching" only while it works on something.
	return { chip: doing?.working ? "Teaching" : "Running", line: doing?.working ? doing.text : "Nothing to do right now", note };
}
