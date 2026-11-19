import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { useTerminals } from "./use-terminals";

/** On a page that asks the learner to write in the teacher's terminal: opens it, while godspeed
 *  runs that terminal and its panel is closed. */
export function TerminalKey() {
	const teacher = useTeacher();
	const running = !!useTerminals()?.teacher;
	if (!teacher || teacher.panelOpen || !running) return null;
	return (
		<button type="button" data-testid="terminal-key" onClick={() => teacher.showTerminal()} className="lh-btn lh-btn-main text-[15px]">
			Open the terminal
		</button>
	);
}
